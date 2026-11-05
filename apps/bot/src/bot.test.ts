import { describe, expect, it } from "vitest";
import { createBot } from "./bot.js";

const botInfo = {
  id: 1,
  is_bot: true as const,
  first_name: "Pot Bot",
  username: "pot_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: true,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

function privateMessage(text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      text,
      chat: { id: 42, type: "private" as const, first_name: "Abel" },
      from: { id: 42, is_bot: false as const, first_name: "Abel", language_code: "en" },
      entities: text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.length }] : [],
    },
  };
}

function botWithCapturedReplies() {
  // These tests only cover commands that touch neither the database nor FPL.
  const bot = createBot("test-token", { db: {} as never, fpl: {} as never }, { botInfo });
  const replies: { method: string; chat_id: unknown; text: unknown }[] = [];
  // Replaces the network call, so tests never reach Telegram.
  bot.api.config.use(async (_prev, method, payload) => {
    const { chat_id, text } = payload as { chat_id?: unknown; text?: unknown };
    replies.push({ method, chat_id, text });
    return { ok: true, result: true } as never;
  });
  return { bot, replies };
}

describe("bot", () => {
  it("answers /start with a welcome that uses the sender's name", async () => {
    const { bot, replies } = botWithCapturedReplies();
    await bot.handleUpdate(privateMessage("/start"));

    expect(replies).toHaveLength(1);
    expect(replies[0]?.method).toBe("sendMessage");
    expect(replies[0]?.chat_id).toBe(42);
    expect(replies[0]?.text).toContain("Hi Abel!");
  });

  it("stays quiet on ordinary messages", async () => {
    const { bot, replies } = botWithCapturedReplies();
    await bot.handleUpdate(privateMessage("hello"));

    expect(replies).toEqual([]);
  });
});
