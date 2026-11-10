import { readFileSync } from "node:fs";
import { ScreenshotReadError, type ScreenshotReading } from "@potbot/ai";
import { createDb, type PrismaClient } from "@potbot/db";
import { createFplClient, type FplEntryHistory } from "@potbot/fpl";
import type { Update, UserFromGetMe } from "grammy/types";
import { createBot } from "../bot.js";
import { syncAllLeagues } from "../services/league-sync.js";
import { tickAllLeagues, type SendOptions } from "../services/settlement.js";
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

/** Lets a test play out a gameweek that hasn't happened in the saved data. */
export interface FplWorld {
  /** Gameweeks FPL should report as finished, beyond the saved data. */
  finished?: Record<number, { dataChecked?: boolean }>;
  eventStatus?: { status: { bonus_added: boolean; date: string; event: number; points: string }[]; leagues: string };
  /** Extra history rows, by gameweek then FPL team ID. Teams left out score 30. */
  scores?: Record<number, Record<number, { points: number; cost?: number; total?: number; bench?: number }>>;
  fail?: boolean;
  /** Moved deadlines, by gameweek. */
  deadlines?: Record<number, string>;
  /** Fails only the live points, which only awards use. */
  failLive?: boolean;
  /** Replaces the league's member list, as FPL's standings rows. */
  managers?: unknown[];
}

export const fixtureManagers = (): unknown[] => fixture<{ managers: unknown[] }>(`league-${LEAGUE_ID}.json`).managers;

interface BootstrapFixture {
  elements: { id: number; web_name: string; team: number }[];
  events: { id: number; finished: boolean; data_checked: boolean; is_current: boolean; is_next: boolean }[];
}

/** Serves saved real responses in place of the FPL API (hard rule 3). */
export function fixtureFetch(options: { failHistories?: boolean; world?: FplWorld } = {}): typeof globalThis.fetch {
  const world = options.world ?? {};
  // Only events are used here, and serving the full 2.5 MB fixture on every tick makes these tests crawl.
  const { events, elements } = fixture<BootstrapFixture>("bootstrap-static.json");
  const bootstrap = {
    events,
    teams: [],
    elements: elements.map(({ id, web_name, team }) => ({ id, web_name, team })),
  };
  const picks = fixture<Record<string, unknown>>(`picks-${LEAGUE_ID}-gw9.json`);
  const live = {
    elements: fixture<{ elements: { id: number; stats: { total_points: number } }[] }>("live-gw9.json").elements.map(
      ({ id, stats }) => ({ id, stats: { total_points: stats.total_points } }),
    ),
  };
  const histories = fixture<Record<string, FplEntryHistory>>(`histories-${LEAGUE_ID}.json`);
  const { league, managers } = fixture<{ league: unknown; managers: unknown[] }>(`league-${LEAGUE_ID}.json`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  return async (input) => {
    const path = new URL(String(input)).pathname.replace("/api/", "");
    if (world.fail) return json({}, 503);
    if (path === "bootstrap-static/") {
      const finished = world.finished ?? {};
      return json({
        ...bootstrap,
        events: bootstrap.events.map((event) => ({
          ...event,
          ...(finished[event.id] ? { finished: true, data_checked: finished[event.id]?.dataChecked ?? false } : {}),
          ...(world.deadlines?.[event.id] ? { deadline_time: world.deadlines[event.id] } : {}),
        })),
      });
    }
    if (path === "event-status/") return json(world.eventStatus ?? { status: [], leagues: "" });
    if (path === `leagues-classic/${LEAGUE_ID}/standings/`) {
      return json({
        league,
        standings: { has_next: false, results: world.managers ?? managers },
        new_entries: { has_next: false, results: [] },
      });
    }
    // Saved GW9 picks and points stand in for whichever gameweek a test plays out.
    const pickEntry = path.match(/^entry\/(\d+)\/event\/\d+\/picks\/$/)?.[1];
    if (pickEntry) return picks[pickEntry] ? json(picks[pickEntry]) : json({}, 404);
    if (/^event\/\d+\/live\/$/.test(path)) return world.failLive ? json({}, 503) : json(live);

    const entry = path.match(/^entry\/(\d+)\/history\/$/)?.[1];
    if (entry) {
      if (options.failHistories) return json({}, 503);
      const history = histories[entry];
      if (history) {
        const extra = Object.entries(world.scores ?? {}).map(([event, teams]) => {
          const score = teams[Number(entry)] ?? { points: 30 };
          return {
            event: Number(event),
            points: score.points,
            total_points: score.total ?? 0,
            event_transfers_cost: score.cost ?? 0,
            points_on_bench: score.bench ?? 0,
          };
        });
        return json({ ...history, current: [...history.current, ...extra] });
      }
    }
    return json({}, 404);
  };
}

export interface Person {
  id: number;
  first_name: string;
  language_code?: string;
  username?: string;
}

export const OWNER: Person = { id: 100, first_name: "Owner", language_code: "en" };
export const ALICE: Person = { id: 101, first_name: "Alice", language_code: "en" };
export const BOB: Person = { id: 102, first_name: "Bob", language_code: "en" };

export interface SentCall {
  method: string;
  payload: Record<string, unknown>;
}

let updateId = 0;

export function createHarness(
  options: {
    chatMemberStatus?: string;
    failHistories?: boolean;
    /**
     * In the saved data, Jazz won GW9 and so starts with a free pass. Most tests use Jazz as an ordinary member who
     * owes, so by default only the runner-up is seeded. Tests about free passes themselves set this.
     */
    realSeed?: boolean;
  } = {},
) {
  const db = createDb(TEST_DATABASE_URL);
  const world: FplWorld = {};
  // The clock jumps on every read, so the bootstrap cache never hides a change a test makes to the world.
  let fplClock = 0;
  const fpl = createFplClient({
    fetch: fixtureFetch({ failHistories: options.failHistories ?? false, world }),
    sleep: async () => {},
    now: () => (fplClock += 60 * 60 * 1000),
  });
  /** Text the fake AI returns. Left unset, it fails, as Gemini does when overloaded. */
  const ai = { reply: undefined as string | undefined, calls: [] as { system: string; prompt: string }[] };
  const generateText = async (system: string, prompt: string) => {
    ai.calls.push({ system, prompt });
    if (ai.reply === undefined) throw new Error("Gemini is down");
    return ai.reply;
  };
  const reader = { reading: undefined as ScreenshotReading | undefined, fails: false, calls: 0 };
  const clock = { now: new Date("2026-11-05T12:00:00Z") };
  const bot = createBot(
    "test-token",
    {
      db,
      fpl,
      readScreenshot: async () => {
        reader.calls += 1;
        if (reader.fails || !reader.reading) throw new ScreenshotReadError("Gemini is down");
        return reader.reading;
      },
      downloadFile: async () => ({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" }),
      generateText,
      now: () => clock.now,
    },
    { botInfo },
  );

  const calls: SentCall[] = [];
  /** What Telegram says about people's membership of the group. */
  const groupMembership = {
    statuses: new Map<number, string>(),
    extra: {} as Record<string, unknown>,
    failing: false,
  };
  /** Chats that haven't pressed Start, so private messages to them fail. */
  const blockedChats = new Set<number>();
  // Replaces the network call, so tests never reach Telegram.
  bot.api.config.use(async (_prev, method, payload) => {
    const chatId = (payload as { chat_id?: number }).chat_id;
    if (chatId !== undefined && blockedChats.has(chatId)) throw new Error("Forbidden: bot can't initiate conversation");
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getChatMember") {
      const userId = (payload as { user_id: number }).user_id;
      if (groupMembership.failing) throw new Error("Bad Request: not enough rights");
      const status = groupMembership.statuses.get(userId) ?? options.chatMemberStatus ?? "administrator";
      return { ok: true, result: { status, ...groupMembership.extra } } as never;
    }
    if (method === "sendMessage") return { ok: true, result: { message_id: ++updateId } } as never;
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

  const posts: { chatId: bigint; text: string; parseMode?: string; replyMarkup?: unknown }[] = [];
  const telegram = { down: false };
  const send = async (chatId: bigint, text: string, options?: SendOptions) => {
    if (telegram.down || blockedChats.has(Number(chatId))) throw new Error("Telegram is down");
    posts.push({
      chatId,
      text,
      ...(options?.parse_mode ? { parseMode: options.parse_mode } : {}),
      ...(options?.reply_markup ? { replyMarkup: options.reply_markup } : {}),
    });
  };

  return {
    db,
    fpl,
    calls,
    world,
    posts,
    telegram,
    ai,
    reader,
    clock,
    blockedChats,
    groupMembership,
    /** A photo message. Put "@pot_test_bot" in the caption to mention the bot. */
    photo: (from: Person, chatId: number, options: { caption?: string; fileId?: string; messageId?: number } = {}) => {
      const fileId = options.fileId ?? `file-${++updateId}`;
      const caption = options.caption;
      const offset = caption?.indexOf("@pot_test_bot") ?? -1;
      return bot.handleUpdate({
        update_id: ++updateId,
        message: {
          message_id: options.messageId ?? updateId,
          date: 0,
          chat:
            chatId < 0
              ? { id: chatId, type: "supergroup", title: "Office" }
              : { id: chatId, type: "private", first_name: from.first_name },
          from: { is_bot: false, ...from },
          photo: [{ file_id: fileId, file_unique_id: `unique-${fileId}`, width: 1, height: 1 }],
          ...(caption ? { caption } : {}),
          ...(offset >= 0 ? { caption_entities: [{ type: "mention", offset, length: "@pot_test_bot".length }] } : {}),
        },
      } as Update);
    },
    tick: (now: Date) => tickAllLeagues({ db, fpl, send, generateText }, now),
    sync: () => syncAllLeagues({ db, fpl, send, botUsername: botInfo.username }),
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
    tap: async (from: Person, chatId: number, data: string, callbackExtra: object = {}) => {
      await bot.handleUpdate({
        update_id: ++updateId,
        callback_query: {
          id: String(updateId),
          from: { is_bot: false, ...from },
          chat_instance: "test",
          data,
          message: {
            message_id: 1,
            date: 0,
            ...callbackExtra,
            chat:
              chatId < 0
                ? { id: chatId, type: "supergroup", title: "Office" }
                : { id: chatId, type: "private", first_name: from.first_name },
            text: "",
          },
        },
      } as Update);
      if (data === "setup:confirm" && !options.realSeed) {
        const ephrem = await db.member.findFirst({ where: { fplEntryId: 11201236 }, orderBy: { id: "desc" } });
        if (ephrem) {
          await db.league.update({ where: { id: ephrem.leagueId }, data: { seedFreePassMemberIds: [ephrem.id] } });
        }
      }
    },
  };
}

const TABLES = [
  "audit_log",
  "messages_log",
  "member_facts",
  "payout_requests",
  "payouts",
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
