import { Composer, type Context } from "grammy";
import { isUniqueViolation } from "../services/users.js";
import type { BotDeps } from "./deps.js";

/**
 * Telegram gives a group a new chat ID when it upgrades to a supergroup, for example when some settings change.
 * Without this, every post to the group would fail from then on. It sends a message to both chats, so either works.
 */
export function groupMigration({ db }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  async function move(from: number, to: number) {
    try {
      await db.league.updateMany({ where: { telegramChatId: BigInt(from) }, data: { telegramChatId: BigInt(to) } });
    } catch (error) {
      // The new chat already has a league, which only a person can sort out.
      if (!isUniqueViolation(error)) throw error;
      console.error(`Couldn't move a league from chat ${from} to ${to}, because ${to} already has one.`);
    }
  }

  composer.on("message:migrate_to_chat_id", (ctx) => move(ctx.chat.id, ctx.message.migrate_to_chat_id));
  composer.on("message:migrate_from_chat_id", (ctx) => move(ctx.message.migrate_from_chat_id, ctx.chat.id));

  return composer;
}
