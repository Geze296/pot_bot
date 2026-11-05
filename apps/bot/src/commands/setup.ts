import { Composer, InlineKeyboard, type Context } from "grammy";
import { FplNotFoundError, parseLeagueInput } from "@potbot/fpl";
import type { League, Member } from "@potbot/db";
import { formatLocalTime } from "../i18n/format.js";
import { t, toLanguage, type Language } from "../i18n/index.js";
import { backfillSeason, cancelLeague, prepareLeague, SETUP_STATE, type SeasonWeek } from "../services/league-setup.js";
import { ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";

const languageOf = (ctx: Context): Language => toLanguage(ctx.from?.language_code);

function seasonLines(language: Language, season: SeasonWeek[], members: Member[]): string[] {
  const names = (ids: number[]) =>
    ids
      .map((id) => {
        const member = members.find((other) => other.id === id);
        return member?.fplManagerName ?? String(id);
      })
      .join(" & ") || t(language, "setup.nobody");
  const net = (week: SeasonWeek, ids: number[]) => {
    const score = week.ranking.standings.find((standing) => standing.id === ids[0])?.net;
    return score === undefined ? "" : ` (${score})`;
  };

  return season.map((week) =>
    t(language, "setup.seasonLine", {
      gw: week.eventId,
      winners: names(week.ranking.winnerIds) + net(week, week.ranking.winnerIds),
      runnersUp: names(week.ranking.runnerUpIds) + net(week, week.ranking.runnerUpIds),
    }),
  );
}

export function setupCommands({ db, fpl }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  composer.command("setup", async (ctx) => {
    const language = languageOf(ctx);
    if (ctx.chat.type === "private") return ctx.reply(t(language, "setup.groupOnly"));

    const member = await ctx.getChatMember(ctx.from!.id);
    if (member.status !== "creator" && member.status !== "administrator") {
      return ctx.reply(t(language, "setup.adminOnly"));
    }

    const existing = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat.id) } });
    if (existing?.setupState === SETUP_STATE.active) {
      return ctx.reply(t(language, "setup.alreadyLinked", { name: existing.name }));
    }

    // "/setup <league> <gw>" starts earlier and backfills. Without a gameweek, the bot starts at the next one.
    const [leagueArg = "", gwArg] = ctx.match.trim().split(/\s+/);
    const input = parseLeagueInput(leagueArg);
    if (input.kind === "invite") return ctx.reply(t(language, "setup.inviteLink"));
    if (input.kind === "invalid") return ctx.reply(t(language, "setup.usage"));

    let standings;
    let requestedGw: number | null = null;
    try {
      standings = await fpl.getLeagueStandings(input.leagueId);
      if (gwArg !== undefined) {
        const { events } = await fpl.getBootstrap();
        const next = events.find((event) => event.is_next)?.id ?? events.at(-1)?.id ?? 1;
        requestedGw = Number(gwArg);
        if (!Number.isInteger(requestedGw) || requestedGw < standings.league.start_event || requestedGw > next) {
          return ctx.reply(t(language, "setup.badGw", { first: standings.league.start_event, next }));
        }
      }
    } catch (error) {
      if (error instanceof FplNotFoundError) {
        return ctx.reply(t(language, "setup.notFound", { id: input.leagueId }));
      }
      return ctx.reply(t(language, "common.fplDown"));
    }

    const owner = await ensureUser(db, ctx.from!);
    await prepareLeague(db, { chatId: ctx.chat.id, ownerUserId: owner.id, standings, firstPotGw: requestedGw });

    const managers = standings.managers
      .map((manager, index) =>
        t(language, "setup.managerLine", {
          position: index + 1,
          team: manager.teamName,
          manager: manager.managerName,
        }),
      )
      .join("\n");
    return ctx.reply(
      t(language, "setup.preview", { name: standings.league.name, count: standings.managers.length, managers }),
      {
        reply_markup: new InlineKeyboard()
          .text(t(language, "setup.confirmButton"), "setup:confirm")
          .text(t(language, "setup.cancelButton"), "setup:cancel"),
      },
    );
  });

  /** Finds the group's league, and refuses anyone but its owner. */
  async function ownedLeague(ctx: Context, state: string): Promise<League | undefined> {
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat!.id) } });
    if (!league || league.setupState !== state) {
      await ctx.answerCallbackQuery();
      return undefined;
    }
    const user = await ensureUser(db, ctx.from!);
    if (league.ownerUserId !== user.id) {
      await ctx.answerCallbackQuery({ text: t(languageOf(ctx), "common.ownerOnly"), show_alert: true });
      return undefined;
    }
    return league;
  }

  composer.callbackQuery("setup:cancel", async (ctx) => {
    const league = await ownedLeague(ctx, SETUP_STATE.awaitingConfirm);
    if (!league) return;
    await cancelLeague(db, league.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(languageOf(ctx), "setup.cancelled"));
  });

  composer.callbackQuery("setup:confirm", async (ctx) => {
    const league = await ownedLeague(ctx, SETUP_STATE.awaitingConfirm);
    if (!league) return;
    const language = languageOf(ctx);

    // A double tap must not run the backfill twice.
    const claimed = await db.league.updateMany({
      where: { id: league.id, setupState: SETUP_STATE.awaitingConfirm },
      data: { setupState: SETUP_STATE.backfilling },
    });
    if (claimed.count === 0) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(language, "setup.working"));

    let summary;
    let firstPotGw;
    try {
      const { events } = await fpl.getBootstrap();
      firstPotGw = league.firstPotGw ?? events.find((event) => event.is_next)?.id;
      if (firstPotGw === undefined) {
        await cancelLeague(db, league.id);
        await ctx.editMessageText(t(language, "setup.noNextGw"));
        return;
      }
      summary = await backfillSeason(db, fpl, { leagueId: league.id, firstPotGw });
    } catch {
      await db.league.update({ where: { id: league.id }, data: { setupState: SETUP_STATE.awaitingConfirm } });
      await ctx.editMessageText(t(language, "common.fplDown"), {
        reply_markup: new InlineKeyboard().text(t(language, "setup.retryButton"), "setup:confirm"),
      });
      return;
    }

    const members = await db.member.findMany({ where: { leagueId: league.id } });
    const lines = [t(language, "setup.done", { name: league.name, gw: firstPotGw })];
    if (summary.season.length > 0) {
      lines.push("", t(language, "setup.seasonHeader"), ...seasonLines(language, summary.season, members));
    } else {
      lines.push("", t(language, "setup.seasonEmpty"));
    }
    if (summary.seedFreePassMemberIds.length > 0) {
      const names = summary.seedFreePassMemberIds
        .map((id) => members.find((other) => other.id === id)?.fplManagerName ?? String(id))
        .join(" & ");
      const previous = summary.seedFromEvent ?? firstPotGw - 1;
      lines.push("", t(language, "setup.seedFreePass", { gw: previous + 1, names, previous }));
    }
    const upcoming = summary.events.find((event) => event.is_next);
    if (upcoming) {
      lines.push(
        t(language, "setup.nextDeadline", {
          gw: upcoming.id,
          deadline: formatLocalTime(new Date(upcoming.deadline_time), league.timezone),
        }),
      );
    }
    await ctx.editMessageText(lines.join("\n"));

    await ctx.reply(t(language, "setup.joinPrompt"), {
      reply_markup: new InlineKeyboard().url(
        t(language, "setup.joinButton"),
        `https://t.me/${ctx.me.username}?start=join_${league.joinToken}`,
      ),
    });
  });

  return composer;
}
