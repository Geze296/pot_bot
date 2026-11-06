import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webhookCallback } from "grammy";
import { describe, expect, it } from "vitest";
import { createBot } from "../bot.js";
import { botInfo } from "../testing/harness.js";
import { createApi } from "./server.js";

const healthy = async () => {};

describe("GET /health", () => {
  it("returns ok when the database answers", async () => {
    const api = await createApi({ checkDb: healthy });
    const response = await api.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns 503 when the database does not answer", async () => {
    const api = await createApi({
      checkDb: async () => {
        throw new Error("connection refused");
      },
    });
    const response = await api.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "db_unavailable" });
  });
});

describe("serving the Mini App", () => {
  it("serves the built app, and doesn't let a path escape its folder", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "potbot-web-"));
    writeFileSync(join(webDir, "index.html"), "<p>app</p>");
    const api = await createApi({ checkDb: healthy, webDir });

    const page = await api.inject({ method: "GET", url: "/" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("app");

    const escape = await api.inject({ method: "GET", url: "/../../../../etc/passwd" });
    expect(escape.body).not.toContain("root:");
  });

  it("starts without a built app", async () => {
    const api = await createApi({ checkDb: healthy, webDir: "/nonexistent" });

    expect((await api.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("the Telegram webhook", () => {
  function webhookApi() {
    const bot = createBot("test-token", { db: {} as never, fpl: {} as never }, { botInfo });
    const sent: string[] = [];
    bot.api.config.use(async (_prev, _method, payload) => {
      sent.push(String((payload as { text?: string }).text));
      return { ok: true, result: { message_id: 1 } } as never;
    });
    const handler = webhookCallback(bot, "fastify", { secretToken: "s3cret", onTimeout: "return" });
    return { sent, api: createApi({ checkDb: healthy, telegramWebhook: { path: "/telegram/webhook", handler } }) };
  }

  const update = {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      text: "/start",
      chat: { id: 42, type: "private", first_name: "Abel" },
      from: { id: 42, is_bot: false, first_name: "Abel", language_code: "en" },
      entities: [{ type: "bot_command", offset: 0, length: 6 }],
    },
  };

  it("handles an update carrying Telegram's secret", async () => {
    const { api, sent } = webhookApi();
    const response = await (
      await api
    ).inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "s3cret" },
      payload: update,
    });

    expect(response.statusCode).toBe(200);
    expect(sent[0]).toContain("Hi Abel!");
  });

  it("refuses a request without it", async () => {
    const { api, sent } = webhookApi();
    const response = await (await api).inject({ method: "POST", url: "/telegram/webhook", payload: update });

    expect(response.statusCode).toBe(401);
    expect(sent).toEqual([]);
  });
});
