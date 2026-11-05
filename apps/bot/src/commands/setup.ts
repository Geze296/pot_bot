import { Composer, InlineKeyboard, type Context } from "grammy";
import { FplNotFoundError, parseLeagueInput, type FplEvent } from "@potbot/fpl";
import type { League, Member } from "@potbot/db";
import { t, toLanguage, type Language } from "../i18n/index.js";
import { backfillSeason, cancelLeague, prepareLeague, SETUP_STATE, type SeasonWeek } from "../services/league-setup.js";
import { ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";

const GW_BUTTONS_PER_ROW = 5;

const languageOf = (ctx: Context): Language => toLanguage(ctx.from?.language_code);

function formatDeadline(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

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

function firstGwKeyboard(firstEvent: number, lastEvent: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let event = firstEvent; event <= lastEvent; event++) {
    keyboard.text(`GW${event}`, `setup:gw:${event}`);
    if ((event - firstEvent + 1) % GW_BUTTONS_PER_ROW === 0) keyboard.row();
  }
  return keyboard;
}

/** The next gameweek to play. At the end of a season there is none, so the last one is used. */
const nextEventId = (events: FplEvent[]): number => events.find((event) => event.is_next)?.id ?? events.at(-1)?.id ?? 1;

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

    const input = parseLeagueInput(ctx.match);
    if (input.kind === "invite") return ctx.reply(t(language, "setup.inviteLink"));
    if (input.kind === "invalid") return ctx.reply(t(language, "setup.usage"));

    let standings;
    try {
      standings = await fpl.getLeagueStandings(input.leagueId);
    } catch (error) {
      if (error instanceof FplNotFoundError) {
        return ctx.reply(t(language, "setup.notFound", { id: input.leagueId }));
      }
      return ctx.reply(t(language, "common.fplDown"));
    }

    const owner = await ensureUser(db, ctx.from!);
    await prepareLeague(db, { chatId: ctx.chat.id, ownerUserId: owner.id, standings });

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

    try {
      const [{ events }, { league: fplLeague }] = await Promise.all([
        fpl.getBootstrap(),
        fpl.getLeagueStandings(league.fplLeagueId),
      ]);
      await db.league.update({ where: { id: league.id }, data: { setupState: SETUP_STATE.awaitingFirstGw } });
      await ctx.answerCallbackQuery();

      const next = nextEventId(events);
      await ctx.editMessageText(t(language, "setup.pickFirstGw", { next }), {
        reply_markup: firstGwKeyboard(Math.min(fplLeague.start_event, next), next),
      });
    } catch {
      await ctx.answerCallbackQuery({ text: t(language, "common.fplDown"), show_alert: true });
    }
  });

  composer.callbackQuery(/^setup:gw:(\d+)$/, async (ctx) => {
    const league = await ownedLeague(ctx, SETUP_STATE.awaitingFirstGw);
    if (!league) return;
    const language = languageOf(ctx);
    const firstPotGw = Number(ctx.match[1]);

    // A double tap must not run the backfill twice.
    const claimed = await db.league.updateMany({
      where: { id: league.id, setupState: SETUP_STATE.awaitingFirstGw },
      data: { setupState: SETUP_STATE.backfilling },
    });
    if (claimed.count === 0) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(t(language, "setup.working"));

    let summary;
    try {
      summary = await backfillSeason(db, fpl, { leagueId: league.id, firstPotGw });
    } catch {
      await db.league.update({ where: { id: league.id }, data: { setupState: SETUP_STATE.awaitingFirstGw } });
      await ctx.editMessageText(t(language, "common.fplDown"), {
        reply_markup: new InlineKeyboard().text(`GW${firstPotGw}`, `setup:gw:${firstPotGw}`),
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
      lines.push("", t(language, "setup.seedFreePass", { gw: firstPotGw, names, previous: firstPotGw - 1 }));
    }
    const upcoming = summary.events.find((event) => event.is_next);
    if (upcoming) {
      lines.push(
        t(language, "setup.nextDeadline", {
          gw: upcoming.id,
          deadline: formatDeadline(upcoming.deadline_time, league.timezone),
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
