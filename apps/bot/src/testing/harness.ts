import { readFileSync } from "node:fs";
import { createDb, type PrismaClient } from "@potbot/db";
import { createFplClient, type FplEntryHistory } from "@potbot/fpl";
import type { Update, UserFromGetMe } from "grammy/types";
import { createBot } from "../bot.js";
import { TEST_DATABASE_URL, TEST_SCHEMA } from "./database-url.js";

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../../../fixtures/fpl/${name}`, import.meta.url), "utf8")) as T;

export const LEAGUE_ID = 1680179;
export const GROUP_ID = -100123;

export const botInfo: UserFromGetMe = {
  id: 1,
  is_bot: true,
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

/** Serves saved real responses in place of the FPL API (hard rule 3). */
export function fixtureFetch(options: { failHistories?: boolean } = {}): typeof globalThis.fetch {
  const bootstrap = fixture<unknown>("bootstrap-static.json");
  const histories = fixture<Record<string, FplEntryHistory>>(`histories-${LEAGUE_ID}.json`);
  const { league, managers } = fixture<{ league: unknown; managers: unknown[] }>(`league-${LEAGUE_ID}.json`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  return async (input) => {
    const path = new URL(String(input)).pathname.replace("/api/", "");
    if (path === "bootstrap-static/") return json(bootstrap);
    if (path === `leagues-classic/${LEAGUE_ID}/standings/`) {
      return json({
        league,
        standings: { has_next: false, results: managers },
        new_entries: { has_next: false, results: [] },
      });
    }
    const entry = path.match(/^entry\/(\d+)\/history\/$/)?.[1];
    if (entry) {
      if (options.failHistories) return json({}, 503);
      if (histories[entry]) return json(histories[entry]);
    }
    return json({}, 404);
  };
}

export interface Person {
  id: number;
  first_name: string;
  language_code?: string;
}

export const OWNER: Person = { id: 100, first_name: "Owner", language_code: "en" };
export const ALICE: Person = { id: 101, first_name: "Alice", language_code: "en" };
export const BOB: Person = { id: 102, first_name: "Bob", language_code: "en" };

export interface SentCall {
  method: string;
  payload: Record<string, unknown>;
}

let updateId = 0;

export function createHarness(options: { chatMemberStatus?: string; failHistories?: boolean } = {}) {
  const db = createDb(TEST_DATABASE_URL);
  const fpl = createFplClient({
    fetch: fixtureFetch({ failHistories: options.failHistories ?? false }),
    sleep: async () => {},
  });
  const bot = createBot("test-token", { db, fpl }, { botInfo });

  const calls: SentCall[] = [];
  // Replaces the network call, so tests never reach Telegram.
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getChatMember") {
      return { ok: true, result: { status: options.chatMemberStatus ?? "administrator" } } as never;
    }
    return { ok: true, result: true } as never;
  });

  const message = (from: Person, chatId: number, text: string, extra: object = {}): Update => {
    const commandLength = text.startsWith("/") ? (text.split(" ")[0]?.length ?? 0) : 0;
    return {
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: 0,
        text,
        chat:
          chatId < 0
            ? { id: chatId, type: "supergroup", title: "Office" }
            : { id: chatId, type: "private", first_name: from.first_name },
        from: { is_bot: false, ...from },
        entities: commandLength ? [{ type: "bot_command", offset: 0, length: commandLength }] : [],
        ...extra,
      },
    } as Update;
  };

  return {
    db,
    calls,
    /** Text of every message and edit sent since the last call. */
    takeTexts(): string[] {
      const texts = calls
        .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
        .map((call) => String(call.payload.text));
      calls.length = 0;
      return texts;
    },
    lastKeyboard(): { text: string; callback_data?: string; url?: string }[][] {
      const withKeyboard = calls.filter((call) => call.payload.reply_markup).at(-1);
      const markup = withKeyboard?.payload.reply_markup as { inline_keyboard: never[][] } | undefined;
      return markup?.inline_keyboard ?? [];
    },
    say: (from: Person, chatId: number, text: string, extra?: object) =>
      bot.handleUpdate(message(from, chatId, text, extra)),
    tap: (from: Person, chatId: number, data: string) =>
      bot.handleUpdate({
        update_id: ++updateId,
        callback_query: {
          id: String(updateId),
          from: { is_bot: false, ...from },
          chat_instance: "test",
          data,
          message: {
            message_id: 1,
            date: 0,
            chat:
              chatId < 0
                ? { id: chatId, type: "supergroup", title: "Office" }
                : { id: chatId, type: "private", first_name: from.first_name },
            text: "",
          },
        },
      } as Update),
  };
}

const TABLES = [
  "audit_log",
  "messages_log",
  "member_facts",
  "results",
  "scores",
  "payments",
  "obligations",
  "gameweeks",
  "members",
  "leagues",
  "users",
];

/** Raw SQL ignores the client's schema setting, so every table is named with the test schema to protect dev data. */
export async function clearDatabase(db: PrismaClient): Promise<void> {
  const tables = TABLES.map((table) => `"${TEST_SCHEMA}"."${table}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}
