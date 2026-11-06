import type { League } from "@potbot/db";
import { Composer, type Context } from "grammy";
import { t, toLanguage } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { payoutCard, recordPayout, unpaidShares, type PayoutResult } from "../services/payouts.js";
import { ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";

export function payoutCommands(deps: BotDeps): Composer<Context> {
  const { db } = deps;
  const composer = new Composer<Context>();
  const now = () => deps.now?.() ?? new Date();

  const canManage = (league: League, actorId: number) =>
    actorId === league.ownerUserId || actorId === league.coordinatorUserId;

  /** Sent directly so it stays: the group keeps the record of the pot being delivered. */
  const announce = (ctx: Context, league: League, result: Extract<PayoutResult, { kind: "done" }>, gw: number) =>
    ctx.api.sendMessage(
      Number(league.telegramChatId),
      t("en", "payout.delivered", { name: result.member.fplManagerName, amount: result.amount, gw }),
    );

  composer.callbackQuery(/^payout:(\d+):(\d+)$/, async (ctx) => {
    const language = toLanguage(ctx.from.language_code);
    const gameweekId = Number(ctx.match[1]);
    const memberId = Number(ctx.match[2]);

    const gameweek = await db.gameweek.findUnique({ where: { id: gameweekId }, include: { league: true } });
    if (!gameweek) return ctx.answerCallbackQuery();
    const { league } = gameweek;

    const actor = await ensureUser(db, ctx.from);
    if (!canManage(league, actor.id)) {
      return ctx.answerCallbackQuery({ text: t(language, "override.denied"), show_alert: true });
    }

    const result = await recordPayout(db, {
      gameweekId,
      memberId,
      actorId: actor.id,
      leagueId: league.id,
      now: now(),
    });
    await ctx.answerCallbackQuery();
    if (result.kind === "done") await announce(ctx, league, result, gameweek.fplEventId);

    // Whatever happened, show what's still owed. An old button may be for a result that has since been corrected.
    const remaining = await unpaidShares(db, gameweekId);
    if (remaining.length === 0) {
      return ctx.editMessageText(t("en", "payout.allDone", { gw: gameweek.fplEventId }));
    }
    const { text, reply_markup } = payoutCard(gameweek.fplEventId, gameweekId, remaining);
    return ctx.editMessageText(text, { reply_markup });
  });

  composer.command("paidout", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat.id) } });
    if (!league || league.setupState !== SETUP_STATE.active) return ctx.reply(t(language, "common.noLeague"));

    const actor = await ensureUser(db, ctx.from!);
    if (!canManage(league, actor.id)) return ctx.reply(t(language, "override.denied"));

    const [gwText, teamText, txnText] = ctx.match.trim().split(/\s+/);
    const txnId = txnText?.toUpperCase();
    const validTxn = txnId === undefined || /^[A-Z0-9]{6,20}$/.test(txnId);
    if (!gwText || !/^\d+$/.test(gwText) || !teamText || !/^\d+$/.test(teamText) || !validTxn) {
      return ctx.reply(t(language, "payout.usage"));
    }

    const gw = Number(gwText);
    const gameweek = await db.gameweek.findUnique({
      where: { leagueId_fplEventId: { leagueId: league.id, fplEventId: gw } },
    });
    if (!gameweek) return ctx.reply(t(language, "override.noGameweek", { gw }));
    const member = await db.member.findUnique({
      where: { leagueId_fplEntryId: { leagueId: league.id, fplEntryId: Number(teamText) } },
    });
    if (!member) return ctx.reply(t(language, "override.noTeam", { id: teamText }));

    const result = await recordPayout(db, {
      gameweekId: gameweek.id,
      memberId: member.id,
      ...(txnId ? { txnId } : {}),
      actorId: actor.id,
      leagueId: league.id,
      now: now(),
    });
    const vars = { team: member.fplTeamName, gw };
    switch (result.kind) {
      case "done":
        return announce(ctx, league, result, gw);
      case "already":
        return ctx.reply(t(language, "payout.already", vars));
      case "not_settled":
        return ctx.reply(t(language, "payout.notSettled", vars));
      case "not_winner":
        return ctx.reply(t(language, "payout.notWinner", vars));
      case "txn_used":
        return ctx.reply(t(language, "payout.txnUsed"));
    }
  });

  return composer;
}
