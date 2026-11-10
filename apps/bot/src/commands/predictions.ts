import { Composer, type Context } from "grammy";
import { t, toLanguage } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { postPoll, predictableGameweek, recordVote, telegramPolls } from "../services/predictions.js";
import type { BotDeps } from "./deps.js";

/** "Who wins this gameweek?" (PRD F4). For bragging rights only. */
export function predictionCommands(deps: BotDeps): Composer<Context> {
  const { db } = deps;
  const composer = new Composer<Context>();
  const now = () => deps.now?.() ?? new Date();

  composer.command("predict", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    if (ctx.chat.type === "private") return ctx.reply(t(language, "poll.groupOnly"));
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat.id) } });
    if (league?.setupState !== SETUP_STATE.active) return ctx.reply(t(language, "common.noLeague"));

    const gameweek = await predictableGameweek(db, league, now());
    if (!gameweek) return ctx.reply(t(language, "poll.noneOpen"));

    const outcome = await postPoll(db, telegramPolls(ctx.api), league, gameweek);
    if (outcome === "posted") return;
    if (outcome === "nobody") return ctx.reply(t(language, "poll.nobody"));

    // Already up: point at it. It may have been deleted, so the reply still goes without it.
    const { pollMessageId } = await db.gameweek.findUniqueOrThrow({ where: { id: gameweek.id } });
    return ctx.reply(t(language, "poll.already", { gw: gameweek.fplEventId }), {
      ...(pollMessageId ? { reply_parameters: { message_id: pollMessageId, allow_sending_without_reply: true } } : {}),
    });
  });

  composer.on("poll_answer", async (ctx) => {
    const { poll_id: pollId, user, option_ids: optionIds } = ctx.pollAnswer;
    if (!user) return;
    await recordVote(db, { pollId, telegramId: user.id, optionIds }, now());
  });

  return composer;
}
