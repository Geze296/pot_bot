import { ScreenshotReadError, type ScreenshotReading } from "@potbot/ai";
import type { League, Member, PrismaClient, User } from "@potbot/db";
import { checkScreenshot, type ScreenshotDecision } from "@potbot/payments";
import { Composer, InlineKeyboard, type Api, type Context } from "grammy";
import type { Message, MessageEntity } from "grammy/types";
import { formatLocalTime } from "../i18n/format.js";
import { t, toLanguage, type Language, type MessageKey } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import {
  currentGameweek,
  currentObligation,
  decideReview,
  markPaid,
  markUnpaid,
  recordDecision,
  type AnyReviewReason,
} from "../services/payments.js";
import { ensureUser, isUniqueViolation } from "../services/users.js";
import type { BotDeps } from "./deps.js";

/** Keeps a burst of photos, or a bug, from running up the league's AI bill (hard rule 15). */
const DAILY_READ_CAP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Image {
  fileId: string;
  uniqueId: string;
  isPhoto: boolean;
}

function imageIn(message: Message | undefined): Image | null {
  const photo = message?.photo?.at(-1);
  if (photo) return { fileId: photo.file_id, uniqueId: photo.file_unique_id, isPhoto: true };
  const document = message?.document;
  if (document?.mime_type?.startsWith("image/")) {
    return { fileId: document.file_id, uniqueId: document.file_unique_id, isPhoto: false };
  }
  return null;
}

function mentionsBot(text: string | undefined, entities: MessageEntity[] | undefined, username: string): boolean {
  return (entities ?? []).some(
    (entity) =>
      entity.type === "mention" &&
      text?.slice(entity.offset, entity.offset + entity.length).toLowerCase() === `@${username.toLowerCase()}`,
  );
}

function sendImage(
  api: Api,
  chatId: number,
  image: Pick<Image, "fileId" | "isPhoto">,
  options: { caption: string; reply_markup?: InlineKeyboard },
) {
  return image.isPhoto ? api.sendPhoto(chatId, image.fileId, options) : api.sendDocument(chatId, image.fileId, options);
}

/** Only for a message the bot can't otherwise act on: a message to someone may fail if they never pressed Start. */
async function tryDirectMessage(api: Api, telegramId: bigint | undefined, text: string): Promise<void> {
  if (telegramId === undefined) return;
  try {
    await api.sendMessage(Number(telegramId), text);
  } catch (error) {
    console.error("Couldn't send a private message:", error);
  }
}

async function claim(db: PrismaClient, leagueId: number, dedupeKey: string, kind: string): Promise<boolean> {
  try {
    await db.messageLog.create({ data: { leagueId, dedupeKey, kind } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export function paymentCommands(deps: BotDeps): Composer<Context> {
  const { db } = deps;
  const composer = new Composer<Context>();
  const now = () => deps.now?.() ?? new Date();

  async function memberOf(leagueId: number, telegramId: number): Promise<Member | null> {
    return db.member.findFirst({ where: { leagueId, status: "active", user: { telegramId: BigInt(telegramId) } } });
  }

  /** Reads the image. Failure of any kind means "couldn't tell", which goes to the coordinator (hard rule 5). */
  async function read(league: League, image: Image): Promise<ScreenshotReading | null> {
    if (!deps.readScreenshot || !deps.downloadFile) return null;

    const reads = await db.messageLog.count({
      where: {
        leagueId: league.id,
        kind: "screenshot_read",
        sentAt: { gte: new Date(now().getTime() - DAY_MS) },
      },
    });
    if (reads >= DAILY_READ_CAP) return null;

    try {
      const reading = await deps.readScreenshot(await deps.downloadFile(image.fileId));
      await claim(db, league.id, `read:${image.uniqueId}`, "screenshot_read");
      return reading;
    } catch (error) {
      if (!(error instanceof ScreenshotReadError)) console.error("Screenshot download failed:", error);
      return null;
    }
  }

  async function sendForReview(
    ctx: Context,
    language: Language,
    league: League,
    member: Member,
    image: Image,
    review: { paymentId: number; gameweek: number; reason: AnyReviewReason },
    decision: ScreenshotDecision | null,
  ) {
    const known = decision?.kind === "review" || decision?.kind === "accepted" ? decision : undefined;
    const unknown = t("en", "review.unknown");
    const caption = t("en", "review.caption", {
      name: member.fplManagerName,
      team: member.fplTeamName,
      gw: review.gameweek,
      reason: t("en", `review.reason.${review.reason}` as MessageKey),
      txn: known?.txnId ?? unknown,
      amount: known?.amount ?? unknown,
      time: known?.paidAt ? formatLocalTime(known.paidAt, league.timezone) : unknown,
    });
    const keyboard = new InlineKeyboard()
      .text(t("en", "review.approveButton"), `pay:approve:${review.paymentId}`)
      .text(t("en", "review.rejectButton"), `pay:reject:${review.paymentId}`);

    const coordinator = await db.user.findUnique({ where: { id: league.coordinatorUserId ?? league.ownerUserId } });
    try {
      await sendImage(ctx.api, Number(coordinator!.telegramId), image, { caption, reply_markup: keyboard });
    } catch {
      // A coordinator who never pressed Start can't get a private message, and the review mustn't be lost.
      await ctx.api.sendMessage(Number(league.telegramChatId), t("en", "review.coordinatorUnreachable"));
      await sendImage(ctx.api, Number(league.telegramChatId), image, { caption, reply_markup: keyboard });
    }
    await ctx.reply(t(language, "payments.sentToReview"));
  }

  /** Checks one image on behalf of the member who paid, and acts on the answer. */
  async function handleScreenshot(ctx: Context, league: League, member: Member, image: Image, isPrivate: boolean) {
    const language = toLanguage(ctx.from?.language_code);

    const current = await currentObligation(db, league, member);
    if (!current) return ctx.reply(t(language, "payments.noGameweek"));
    // No reason to spend an AI call on someone with nothing to pay.
    if (current.obligation.status === "paid") {
      return ctx.reply(t(language, "payments.alreadyPaid", { gw: current.gameweek.fplEventId }));
    }
    const seen = await db.messageLog.findUnique({
      where: { leagueId_dedupeKey: { leagueId: league.id, dedupeKey: `read:${image.uniqueId}` } },
    });
    if (seen) return ctx.reply(t(language, "payments.sameImage"));

    const reading = await read(league, image);
    const decision: ScreenshotDecision = reading
      ? checkScreenshot(reading, {
          expectedReceiver: league.coordinatorTelebirrName,
          timeZone: league.timezone,
          now: now(),
        })
      : { kind: "review", reason: "ai_unavailable" };

    if (decision.kind === "not_receipt") return ctx.reply(t(language, "payments.notReceipt"));
    if (decision.kind === "rejected") {
      return ctx.reply(
        decision.reason === "failed"
          ? t(language, "payments.failed")
          : t(language, "payments.wrongReceiver", { name: league.coordinatorTelebirrName ?? "" }),
      );
    }

    const result = await recordDecision(db, { league, member, decision, now: now() });
    switch (result.kind) {
      case "no_gameweek":
        return ctx.reply(t(language, "payments.noGameweek"));
      case "duplicate":
        return ctx.reply(t(language, "payments.duplicate"));
      case "short":
        return ctx.reply(t(language, "payments.short", { amount: result.amount, due: result.due }));
      case "review":
        return sendForReview(ctx, language, league, member, image, result, decision);
      case "paid": {
        if (result.lateFor !== undefined) {
          await ctx.reply(t(language, "payments.lateNextWeek", { late: result.lateFor, gw: result.gameweek }));
        }
        const announcement = t("en", "payments.paidGroup", {
          name: member.fplManagerName,
          gw: result.gameweek,
          pot: result.pot,
        });
        if (isPrivate) {
          await sendImage(ctx.api, Number(league.telegramChatId), image, { caption: announcement });
          return ctx.reply(t(language, "payments.paidPrivate", { gw: result.gameweek }));
        }
        return ctx.reply(announcement);
      }
    }
  }

  /** Sends one reminder per gameweek to an unpaid member who posts a photo without mentioning the bot. */
  async function nudge(ctx: Context, league: League, member: Member) {
    const gameweek = await currentGameweek(db, league.id);
    if (!gameweek || now() < gameweek.paymentOpensAt) return;
    const obligation = await db.obligation.findFirst({
      where: { gameweekId: gameweek.id, memberId: member.id, status: "due" },
    });
    if (!obligation) return;
    if (await claim(db, league.id, `nudge:gw${gameweek.fplEventId}:member${member.id}`, "nudge")) {
      await ctx.reply(t("en", "payments.nudge", { name: member.fplManagerName }));
    }
  }

  const activeLeagueForChat = async (chatId: number) => {
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(chatId) } });
    return league?.setupState === SETUP_STATE.active ? league : null;
  };

  composer.on(["message:photo", "message:document"], async (ctx, next) => {
    const image = imageIn(ctx.message);
    if (!image) return next();
    const language = toLanguage(ctx.from.language_code);

    if (ctx.chat.type === "private") {
      const members = await db.member.findMany({
        where: {
          status: "active",
          user: { telegramId: BigInt(ctx.from.id) },
          league: { setupState: SETUP_STATE.active },
        },
        include: { league: true },
      });
      if (members.length === 0) return ctx.reply(t(language, "payments.notLinked"));
      if (members.length > 1) return ctx.reply(t(language, "payments.whichLeague"));
      return handleScreenshot(ctx, members[0]!.league, members[0]!, image, true);
    }

    const league = await activeLeagueForChat(ctx.chat.id);
    if (!league) return next();
    const member = await memberOf(league.id, ctx.from.id);

    if (!mentionsBot(ctx.message.caption, ctx.message.caption_entities, ctx.me.username)) {
      if (member) await nudge(ctx, league, member);
      return;
    }
    if (!member) return ctx.reply(t(language, "payments.notLinked"));
    return handleScreenshot(ctx, league, member, image, false);
  });

  // Someone forgot the mention, or mentions the bot on a friend's photo. The photo's sender is who paid.
  composer.on("message:text", async (ctx, next) => {
    const original = ctx.message.reply_to_message;
    const image = imageIn(original);
    if (!image || ctx.chat.type === "private" || !original?.from) return next();
    if (!mentionsBot(ctx.message.text, ctx.message.entities, ctx.me.username)) return next();

    const league = await activeLeagueForChat(ctx.chat.id);
    if (!league) return next();
    const member = await memberOf(league.id, original.from.id);
    if (!member) return ctx.reply(t(toLanguage(ctx.from.language_code), "payments.notLinked"));
    return handleScreenshot(ctx, league, member, image, false);
  });

  composer.callbackQuery(/^pay:(approve|reject):(\d+)$/, async (ctx) => {
    const language = toLanguage(ctx.from.language_code);
    const approve = ctx.match[1] === "approve";
    const paymentId = Number(ctx.match[2]);

    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      include: { obligation: { include: { gameweek: { include: { league: true } } } } },
    });
    if (!payment) return ctx.answerCallbackQuery();
    const { league } = payment.obligation.gameweek;

    const actor: User = await ensureUser(db, ctx.from);
    if (actor.id !== league.ownerUserId && actor.id !== league.coordinatorUserId) {
      return ctx.answerCallbackQuery({ text: t(language, "override.denied"), show_alert: true });
    }

    const outcome = await decideReview(db, { paymentId, actorId: actor.id, approve });
    await ctx.answerCallbackQuery();
    if (!outcome) return;

    const { member, gameweek, pot } = outcome;
    await ctx.editMessageCaption({
      caption: t(language, approve ? "review.approved" : "review.rejected", {
        name: member.fplManagerName,
        gw: gameweek,
      }),
    });

    const memberUser = member.userId ? await db.user.findUnique({ where: { id: member.userId } }) : null;
    await tryDirectMessage(
      ctx.api,
      memberUser?.telegramId,
      t("en", approve ? "review.memberApproved" : "review.memberRejected", { gw: gameweek }),
    );

    if (!approve) return;
    const announcement = t("en", "payments.paidGroup", { name: member.fplManagerName, gw: gameweek, pot });
    const image = imageIn(ctx.callbackQuery.message as Message | undefined);
    const inGroup = ctx.chat?.id === Number(league.telegramChatId);
    if (image && !inGroup) {
      await sendImage(ctx.api, Number(league.telegramChatId), image, { caption: announcement });
    } else {
      await ctx.api.sendMessage(Number(league.telegramChatId), announcement);
    }
  });

  /** The group's active league, if the sender may manage money there. Otherwise replies and returns nothing. */
  async function asManager(ctx: Context) {
    const language = toLanguage(ctx.from?.language_code);
    const league = await activeLeagueForChat(ctx.chat!.id);
    if (!league) {
      await ctx.reply(t(language, "common.noLeague"));
      return undefined;
    }
    const actor = await ensureUser(db, ctx.from!);
    if (actor.id !== league.ownerUserId && actor.id !== league.coordinatorUserId) {
      await ctx.reply(t(language, "override.denied"));
      return undefined;
    }
    return { league, actor, language };
  }

  composer.command("paid", (ctx) => ctx.reply(t(toLanguage(ctx.from?.language_code), "payments.sendScreenshot")));

  composer.command("settelebirr", async (ctx) => {
    const manager = await asManager(ctx);
    if (!manager) return;
    const { league, actor, language } = manager;
    const name = ctx.match.trim();
    if (!name) return ctx.reply(t(language, "settelebirr.usage"));

    await db.$transaction([
      db.league.update({ where: { id: league.id }, data: { coordinatorTelebirrName: name } }),
      db.auditLog.create({
        data: {
          leagueId: league.id,
          actorId: actor.id,
          action: "telebirr.set_receiver",
          entity: "league",
          entityId: league.id,
          before: { name: league.coordinatorTelebirrName },
          after: { name },
        },
      }),
    ]);
    return ctx.reply(t(language, "settelebirr.done", { name }));
  });

  /** Reads "<team> [gameweek]", defaulting to the gameweek currently open for payment. */
  async function manualTarget(ctx: Context, league: League, language: Language, match: string, usage: MessageKey) {
    const [teamText, gwText] = match.trim().split(/\s+/);
    if (!teamText || !/^\d+$/.test(teamText) || (gwText !== undefined && !/^\d+$/.test(gwText))) {
      await ctx.reply(t(language, usage));
      return undefined;
    }
    const member = await db.member.findUnique({
      where: { leagueId_fplEntryId: { leagueId: league.id, fplEntryId: Number(teamText) } },
    });
    if (!member) {
      await ctx.reply(t(language, "override.noTeam", { id: teamText }));
      return undefined;
    }
    const gameweek = gwText
      ? await db.gameweek.findUnique({
          where: { leagueId_fplEventId: { leagueId: league.id, fplEventId: Number(gwText) } },
        })
      : await currentGameweek(db, league.id);
    if (!gameweek) {
      await ctx.reply(t(language, "override.noGameweek", { gw: gwText ?? "?" }));
      return undefined;
    }
    return { member, gameweek };
  }

  composer.command("markpaid", async (ctx) => {
    const manager = await asManager(ctx);
    if (!manager) return;
    const { league, actor, language } = manager;
    const target = await manualTarget(ctx, league, language, ctx.match, "markpaid.usage");
    if (!target) return;

    const { member, gameweek } = target;
    const result = await markPaid(db, { league, member, gameweek, actorId: actor.id, now: now() });
    const vars = { team: member.fplTeamName, gw: gameweek.fplEventId };
    if (result === "settled") return ctx.reply(t(language, "markpaid.settled", vars));
    return ctx.reply(t(language, result === "already" ? "markpaid.already" : "markpaid.done", vars));
  });

  composer.command("markunpaid", async (ctx) => {
    const manager = await asManager(ctx);
    if (!manager) return;
    const { league, actor, language } = manager;
    const target = await manualTarget(ctx, league, language, ctx.match, "markunpaid.usage");
    if (!target) return;

    const { member, gameweek } = target;
    const result = await markUnpaid(db, { league, member, gameweek, actorId: actor.id });
    const vars = { team: member.fplTeamName, gw: gameweek.fplEventId };
    if (result === "settled") return ctx.reply(t(language, "markpaid.settled", vars));
    return ctx.reply(t(language, result === "not_paid" ? "markunpaid.notPaid" : "markunpaid.done", vars));
  });

  return composer;
}
