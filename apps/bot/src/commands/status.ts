import type { League } from "@potbot/db";
import { Composer, type Context } from "grammy";
import { formatLocalTime, formatTimeLeft } from "../i18n/format.js";
import { t, toLanguage, type Language } from "../i18n/index.js";
import { awardLines, latestAwards } from "../services/awards.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { createLiveTables, type TableRow } from "../services/live-table.js";
import { currentObligation } from "../services/payments.js";
import { leagueStatus } from "../services/reminders.js";
import { ensureObligations } from "../services/settlement.js";
import type { BotDeps } from "./deps.js";

export function statusCommands({ db, fpl, now: nowDep }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const now = () => nowDep?.() ?? new Date();
  const liveTable = createLiveTables(db, fpl, () => now().getTime());

  /** In a group, that group's league. In private, the sender's league, if they're in exactly one. */
  async function leagueFor(ctx: Context, language: Language): Promise<League | undefined> {
    let league: League | null | undefined;
    if (ctx.chat?.type === "private") {
      const members = await db.member.findMany({
        where: { user: { telegramId: BigInt(ctx.from!.id) }, league: { setupState: SETUP_STATE.active } },
        include: { league: true },
      });
      if (members.length > 1) {
        await ctx.reply(t(language, "status.whichLeague"));
        return undefined;
      }
      league = members[0]?.league;
    } else {
      league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat!.id) } });
    }
    if (!league || league.setupState !== SETUP_STATE.active) {
      await ctx.reply(t(language, "common.noLeague"));
      return undefined;
    }
    return league;
  }

  composer.command("status", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const league = await leagueFor(ctx, language);
    if (!league) return;

    // The job may not have opened this gameweek's fees yet.
    const open = await db.gameweek.findFirst({
      where: { leagueId: league.id, status: "open", paymentOpensAt: { lte: now() } },
      orderBy: { fplEventId: "asc" },
    });
    if (open) await db.$transaction((tx) => ensureObligations(tx, league, open));

    const status = await leagueStatus(db, league);
    if (!status) return ctx.reply(t(language, "status.noGameweek"));

    const { gameweek } = status;
    const gw = gameweek.fplEventId;
    const msLeft = gameweek.deadlineAt.getTime() - now().getTime();
    const lines = [
      msLeft > 0
        ? t(language, "status.open", {
            gw,
            deadline: formatLocalTime(gameweek.deadlineAt, league.timezone),
            left: formatTimeLeft(language, msLeft),
          })
        : t(language, "status.closed", { gw }),
      t(language, "status.pot", { pot: status.pot }),
    ];
    const add = (key: Parameters<typeof t>[1], names: string[]) => {
      if (names.length > 0) lines.push(t(language, key, { count: names.length, names: names.join(", ") }));
    };
    add("status.paid", status.paid);
    add("status.freePass", status.freePass);
    add("status.inReview", status.inReview);
    add("status.unpaid", status.unpaid);
    add("status.out", status.out);
    return ctx.reply(lines.join("\n"));
  });

  composer.command("owe", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    if (ctx.chat.type !== "private") return ctx.reply(t(language, "owe.privateOnly"));

    const members = await db.member.findMany({
      where: { user: { telegramId: BigInt(ctx.from!.id) }, league: { setupState: SETUP_STATE.active } },
      include: { league: true },
    });
    if (members.length === 0) return ctx.reply(t(language, "payments.notLinked"));

    const lines: string[] = [];
    for (const member of members) {
      const current = await currentObligation(db, member.league, member);
      if (!current || current.obligation.status !== "due") continue;

      const { gameweek, obligation } = current;
      const inReview = await db.payment.count({ where: { obligationId: obligation.id, verifyStatus: "needs_review" } });
      if (inReview > 0) {
        lines.push(t(language, "owe.inReview", { league: member.league.name, gw: gameweek.fplEventId }));
        continue;
      }
      lines.push(
        t(language, "owe.line", {
          league: member.league.name,
          amount: obligation.amountDue,
          gw: gameweek.fplEventId,
          deadline: formatLocalTime(gameweek.deadlineAt, member.league.timezone),
          left: formatTimeLeft(language, gameweek.deadlineAt.getTime() - now().getTime()),
          receiver: member.league.coordinatorTelebirrName ?? t(language, "reminder.theCoordinator"),
        }),
      );
    }
    return ctx.reply(lines.length > 0 ? lines.join("\n\n") : t(language, "owe.nothing"));
  });

  composer.command("awards", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const league = await leagueFor(ctx, language);
    if (!league) return;

    const latest = await latestAwards(db, league);
    if (!latest) return ctx.reply(t(language, "awards.none"));
    return ctx.reply(awardLines(language, latest.gw, latest.awards, latest.members).join("\n"));
  });

  composer.command("table", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const league = await leagueFor(ctx, language);
    if (!league) return;

    let table;
    try {
      table = await liveTable(league);
    } catch {
      return ctx.reply(t(language, "common.fplDown"));
    }
    if (!table) return ctx.reply(t(language, "table.noGameweek"));

    const line = (row: TableRow) => t(language, "table.line", { rank: row.rank, team: row.team, value: row.value });
    return ctx.reply(
      [
        t(language, table.finished ? "table.final" : "table.live", { gw: table.event }),
        ...table.gameweek.map(line),
        "",
        t(language, "table.overall"),
        ...table.overall.map(line),
      ].join("\n"),
    );
  });

  return composer;
}
