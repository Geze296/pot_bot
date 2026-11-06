import type { Gameweek, League } from "@potbot/db";
import { checkPayoutScreenshot } from "@potbot/payments";
import { Composer, InlineKeyboard, type Context } from "grammy";
import { t, toLanguage } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { payoutCard, recordPayout, unpaidShares, type PayoutResult } from "../services/payouts.js";
import { ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";
import { imageIn, readImage, sendImage } from "./images.js";

/** How long the bot waits for a screenshot after /payout, so a later photo isn't mistaken for one. */
const REQUEST_MINUTES = 30;

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

  /** Which league /payout means: this group's, or in private the one league the sender manages. */
  async function managedLeague(ctx: Context, actorId: number): Promise<League | "none" | "several"> {
    const manages = { OR: [{ ownerUserId: actorId }, { coordinatorUserId: actorId }] };
    const leagues = await db.league.findMany({
      where:
        ctx.chat?.type === "private"
          ? { setupState: SETUP_STATE.active, ...manages }
          : { telegramChatId: BigInt(ctx.chat!.id), setupState: SETUP_STATE.active, ...manages },
    });
    if (leagues.length > 1) return "several";
    return leagues[0] ?? "none";
  }

  /** The oldest settled gameweek someone is still owed a share of. */
  async function nextPayout(league: League) {
    const settled = await db.gameweek.findMany({
      where: { leagueId: league.id, status: "settled" },
      orderBy: { fplEventId: "asc" },
    });
    for (const gameweek of settled) {
      const shares = await unpaidShares(db, gameweek.id);
      if (shares.length > 0) return { gameweek, shares };
    }
    return null;
  }

  async function waitForScreenshot(ctx: Context, actorId: number, gameweek: Gameweek, memberId: number) {
    const chatId = BigInt(ctx.chat!.id);
    const data = { gameweekId: gameweek.id, memberId, createdAt: now() };
    await db.payoutRequest.upsert({
      where: { userId_chatId: { userId: actorId, chatId } },
      create: { userId: actorId, chatId, ...data },
      update: data,
    });
  }

  composer.command("payout", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const actor = await ensureUser(db, ctx.from!);
    const league = await managedLeague(ctx, actor.id);
    if (league === "none") return ctx.reply(t(language, "override.denied"));
    if (league === "several") return ctx.reply(t(language, "payout.whichLeague"));

    const next = await nextPayout(league);
    if (!next) return ctx.reply(t(language, "payout.nothing"));

    const gw = next.gameweek.fplEventId;
    const [only] = next.shares;
    if (next.shares.length === 1 && only) {
      await waitForScreenshot(ctx, actor.id, next.gameweek, only.memberId);
      return ctx.reply(
        t(language, "payout.sendScreenshot", { gw, name: only.member.fplManagerName, amount: only.amount }),
      );
    }

    const keyboard = new InlineKeyboard();
    for (const { member, amount } of next.shares) {
      keyboard.text(`${member.fplManagerName}: ${amount}`, `payoutpick:${next.gameweek.id}:${member.id}`).row();
    }
    return ctx.reply(t(language, "payout.pick", { gw }), { reply_markup: keyboard });
  });

  composer.callbackQuery(/^payoutpick:(\d+):(\d+)$/, async (ctx) => {
    const language = toLanguage(ctx.from.language_code);
    const gameweekId = Number(ctx.match[1]);
    const memberId = Number(ctx.match[2]);
    const gameweek = await db.gameweek.findUnique({ where: { id: gameweekId }, include: { league: true } });
    if (!gameweek) return ctx.answerCallbackQuery();

    const actor = await ensureUser(db, ctx.from);
    if (!canManage(gameweek.league, actor.id)) {
      return ctx.answerCallbackQuery({ text: t(language, "override.denied"), show_alert: true });
    }
    await ctx.answerCallbackQuery();

    const share = (await unpaidShares(db, gameweekId)).find((item) => item.memberId === memberId);
    if (!share) return ctx.editMessageText(t(language, "payout.nothing"));

    await waitForScreenshot(ctx, actor.id, gameweek, memberId);
    return ctx.editMessageText(
      t(language, "payout.sendScreenshot", {
        gw: gameweek.fplEventId,
        name: share.member.fplManagerName,
        amount: share.amount,
      }),
    );
  });

  // Registered ahead of the member payment handler: a screenshot that was asked for is a payout, not a fee.
  composer.on(["message:photo", "message:document"], async (ctx, next) => {
    const image = imageIn(ctx.message);
    if (!image) return next();

    const user = await db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
    const request = user
      ? await db.payoutRequest.findUnique({
          where: { userId_chatId: { userId: user.id, chatId: BigInt(ctx.chat.id) } },
        })
      : null;
    if (!user || !request) return next();
    if (now().getTime() - request.createdAt.getTime() > REQUEST_MINUTES * 60 * 1000) {
      await db.payoutRequest.delete({ where: { id: request.id } });
      return next();
    }

    const language = toLanguage(ctx.from.language_code);
    const gameweek = await db.gameweek.findUniqueOrThrow({
      where: { id: request.gameweekId },
      include: { league: true },
    });
    const { league } = gameweek;
    const gw = gameweek.fplEventId;

    const share = (await unpaidShares(db, gameweek.id)).find((item) => item.memberId === request.memberId);
    if (!share) {
      await db.payoutRequest.delete({ where: { id: request.id } });
      return ctx.reply(t(language, "payout.nothing"));
    }

    const reading = await readImage(deps, league, image, now());
    if (!reading) return ctx.reply(t(language, "payout.cantRead", { gw, team: share.member.fplEntryId }));

    const decision = checkPayoutScreenshot(reading, {
      share: share.amount,
      notBefore: gameweek.deadlineAt,
      timeZone: league.timezone,
      now: now(),
    });
    if (decision.kind !== "accepted") {
      const vars = { due: share.amount, amount: decision.kind === "short" ? decision.amount : 0, gw };
      const key = {
        not_receipt: "payments.notReceipt",
        failed: "payments.failed",
        short: "payments.short",
        too_early: "payout.tooEarly",
        unreadable: "payout.unreadable",
      } as const;
      return ctx.reply(t(language, key[decision.kind], { ...vars, team: share.member.fplEntryId }));
    }

    const result = await recordPayout(db, {
      gameweekId: gameweek.id,
      memberId: share.memberId,
      txnId: decision.txnId,
      actorId: user.id,
      leagueId: league.id,
      now: decision.paidAt,
    });
    if (result.kind === "txn_used") return ctx.reply(t(language, "payout.txnUsed"));
    await db.payoutRequest.delete({ where: { id: request.id } });
    if (result.kind !== "done") return ctx.reply(t(language, "payout.nothing"));

    const delivered = t("en", "payout.delivered", { name: result.member.fplManagerName, amount: result.amount, gw });
    const caption = decision.receiver
      ? `${delivered}\n${t("en", "payout.telebirrShows", { name: decision.receiver })}`
      : delivered;
    // Sent directly so it stays. The group sees the proof too, whichever chat it arrived in.
    if (ctx.chat.type === "private") {
      await sendImage(ctx.api, Number(league.telegramChatId), image, { caption });
      return ctx.reply(t(language, "payout.recorded", { name: result.member.fplManagerName, gw }));
    }
    return ctx.api.sendMessage(ctx.chat.id, caption);
  });

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
