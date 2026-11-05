import type { Context, MiddlewareFn } from "grammy";

export type ScheduleDeletion = (chatId: number, messageId: number) => Promise<unknown>;

/**
 * Makes ctx.reply in a group clean up after itself. Replies to people go this way. Anything the group should keep,
 * like results or "X paid", is sent with ctx.api.sendMessage instead, so it stays.
 */
export function autoDeleteReplies(schedule: ScheduleDeletion | undefined): MiddlewareFn<Context> {
  return (ctx, next) => {
    const chatId = ctx.chat?.id;
    const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    if (schedule && isGroup && chatId !== undefined) {
      const reply = ctx.reply.bind(ctx);
      ctx.reply = (async (...args: Parameters<typeof reply>) => {
        const message = await reply(...args);
        try {
          await schedule(chatId, message.message_id);
        } catch (error) {
          // The reply already went out. A message left behind is better than a lost answer.
          console.error("Couldn't schedule a message for deletion:", error);
        }
        return message;
      }) as typeof ctx.reply;
    }
    return next();
  };
}
