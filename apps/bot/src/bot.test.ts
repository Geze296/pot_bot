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

describe("/app", () => {
  const appBot = (webAppUrl?: string) => {
    const bot = createBot(
      "test-token",
      { db: {} as never, fpl: {} as never, ...(webAppUrl ? { webAppUrl } : {}) },
      { botInfo },
    );
    const sent: { text?: string; reply_markup?: unknown }[] = [];
    bot.api.config.use(async (_prev, _method, payload) => {
      sent.push(payload as { text?: string });
      return { ok: true, result: { message_id: 1 } } as never;
    });
    return { bot, sent };
  };
  const group = (text: string) => {
    const update = privateMessage(text);
    return { ...update, message: { ...update.message, chat: { id: -5, type: "supergroup" as const, title: "x" } } };
  };

  it("shows an app button in private", async () => {
    const { bot, sent } = appBot("https://bot.example.com");
    await bot.handleUpdate(privateMessage("/app"));

    expect(JSON.stringify(sent[0]?.reply_markup)).toContain('"web_app":{"url":"https://bot.example.com"}');
  });

  it("in a group, links to the private chat, because Telegram allows no app button there", async () => {
    const { bot, sent } = appBot("https://bot.example.com");
    await bot.handleUpdate(group("/app"));

    const markup = JSON.stringify(sent[0]?.reply_markup);
    expect(markup).toContain("https://t.me/pot_test_bot?start=app");
    expect(markup).not.toContain("web_app");
  });

  it("the link's /start shows the app button", async () => {
    const { bot, sent } = appBot("https://bot.example.com");
    const update = privateMessage("/start app");
    update.message.entities = [{ type: "bot_command", offset: 0, length: 6 }];
    await bot.handleUpdate(update);

    expect(JSON.stringify(sent[0]?.reply_markup)).toContain("web_app");
  });

  it("says so when there's no public address", async () => {
    const { bot, sent } = appBot();
    await bot.handleUpdate(privateMessage("/app"));

    expect(sent[0]?.text).toContain("isn't available");
  });
});

describe("when something fails", () => {
  it("tells the person instead of going silent", async () => {
    const { bot, replies } = botWithCapturedReplies();
    // No database behind it, so this command throws.
    await bot.handleUpdate(privateMessage("/status"));

    expect(replies.at(-1)?.text).toContain("Something went wrong");
  });

  it("doesn't throw if that message fails too", async () => {
    const bot = createBot("test-token", { db: {} as never, fpl: {} as never }, { botInfo });
    bot.api.config.use(async () => {
      throw new Error("Telegram is down");
    });

    await expect(bot.handleUpdate(privateMessage("/status"))).resolves.toBeUndefined();
  });
});
