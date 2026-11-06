import { createScreenshotReader, createTextGenerator } from "@potbot/ai";
import { createDb } from "@potbot/db";
import { createFplClient } from "@potbot/fpl";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { InputFile, webhookCallback, type Bot } from "grammy";
import { apiRoutes } from "./api/routes.js";
import { createApi } from "./api/server.js";
import { createBot } from "./bot.js";
import { syncMenuButton } from "./commands/app.js";
import { loadConfig } from "./config.js";
import { scheduleMessageDeletion, startJobs } from "./jobs/boss.js";
import { syncAllLeagues } from "./services/league-sync.js";
import { tickAllLeagues, type SendOptions } from "./services/settlement.js";
import { downloadTelegramFile } from "./services/telegram-files.js";

const WEBHOOK_PATH = "/telegram/webhook";
/** Telegram is told to wait about a minute at most, and a screenshot can take longer, so it's answered early. */
const WEBHOOK_REPLY_AFTER_MS = 9_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const db = createDb(config.databaseUrl);
  const fpl = createFplClient();
  const ai = config.geminiApiKey
    ? {
        readScreenshot: createScreenshotReader({ apiKey: config.geminiApiKey }),
        generateText: createTextGenerator({ apiKey: config.geminiApiKey }),
      }
    : {};
  const bot: Bot = createBot(config.botToken, {
    db,
    fpl,
    ...ai,
    downloadFile: (fileId) => downloadTelegramFile(bot.api, config.botToken, fileId),
    ...(config.publicUrl ? { webAppUrl: config.publicUrl } : {}),
    scheduleDeletion: (chatId, messageId) => scheduleMessageDeletion(boss, chatId, messageId),
  });
  const send = (chatId: bigint, text: string, options?: SendOptions) =>
    bot.api.sendMessage(Number(chatId), text, options);
  // Fails here on a bad token, before anything starts. It also gives the username for claim links.
  await bot.init();
  const boss = await startJobs(config.databaseUrl, {
    tick: () => tickAllLeagues({ db, fpl, send, ...ai }, new Date()),
    sync: () => syncAllLeagues({ db, fpl, send, botUsername: bot.botInfo.username }),
    deleteMessage: (chatId, messageId) => bot.api.deleteMessage(chatId, messageId),
  });

  // Derived from the token, so there's no extra secret to manage. Only Telegram is told it.
  const webhookSecret = createHmac("sha256", config.botToken).update("telegram-webhook").digest("hex");
  const api = await createApi({
    checkDb: async () => {
      await db.$queryRaw`SELECT 1`;
    },
    webDir: fileURLToPath(new URL("../../web/dist", import.meta.url)),
    routes: apiRoutes({
      db,
      botToken: config.botToken,
      send,
      sendDocument: (chatId, filename, content) =>
        bot.api.sendDocument(Number(chatId), new InputFile(Buffer.from(content), filename)),
    }),
    ...(config.publicUrl
      ? {
          telegramWebhook: {
            path: WEBHOOK_PATH,
            handler: webhookCallback(bot, "fastify", {
              secretToken: webhookSecret,
              onTimeout: "return",
              timeoutMilliseconds: WEBHOOK_REPLY_AFTER_MS,
            }),
          },
        }
      : {}),
  });
  await api.listen({ port: config.apiPort, host: config.apiHost });
  console.log(`API listening on http://${config.apiHost}:${config.apiPort}`);

  const shutdown = async () => {
    if (!config.publicUrl) await bot.stop();
    await api.close();
    await boss.stop();
    await db.$disconnect();
    if (config.publicUrl) process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await syncMenuButton(bot.api, config.publicUrl);

  if (config.publicUrl) {
    await bot.api.setWebhook(`${config.publicUrl}${WEBHOOK_PATH}`, { secret_token: webhookSecret });
    console.log(`Bot running as @${bot.botInfo.username} with a webhook at ${config.publicUrl}`);
    return;
  }

  // Long polling. Resolves when the bot stops, and rejects on a bad token.
  await bot.start({ onStart: (me) => console.log(`Bot running as @${me.username}`) });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
