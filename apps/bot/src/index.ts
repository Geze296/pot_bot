import { createScreenshotReader } from "@potbot/ai";
import { createDb } from "@potbot/db";
import { createFplClient } from "@potbot/fpl";
import type { Bot } from "grammy";
import { createApi } from "./api/server.js";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { scheduleMessageDeletion, startJobs } from "./jobs/boss.js";
import { syncAllLeagues } from "./services/league-sync.js";
import { tickAllLeagues } from "./services/settlement.js";
import { downloadTelegramFile } from "./services/telegram-files.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  const db = createDb(config.databaseUrl);
  const fpl = createFplClient();
  const bot: Bot = createBot(config.botToken, {
    db,
    fpl,
    ...(config.geminiApiKey ? { readScreenshot: createScreenshotReader({ apiKey: config.geminiApiKey }) } : {}),
    downloadFile: (fileId) => downloadTelegramFile(bot.api, config.botToken, fileId),
    scheduleDeletion: (chatId, messageId) => scheduleMessageDeletion(boss, chatId, messageId),
  });
  const send = (chatId: bigint, text: string, options?: { parse_mode: "HTML" }) =>
    bot.api.sendMessage(Number(chatId), text, options);
  // Fails here on a bad token, before anything starts. It also gives the username for claim links.
  await bot.init();
  const boss = await startJobs(config.databaseUrl, {
    tick: () => tickAllLeagues({ db, fpl, send }, new Date()),
    sync: () => syncAllLeagues({ db, fpl, send, botUsername: bot.botInfo.username }),
    deleteMessage: (chatId, messageId) => bot.api.deleteMessage(chatId, messageId),
  });
  const api = createApi({
    checkDb: async () => {
      await db.$queryRaw`SELECT 1`;
    },
  });
  await api.listen({ port: config.apiPort, host: "127.0.0.1" });
  console.log(`API listening on http://127.0.0.1:${config.apiPort}`);

  const shutdown = async () => {
    await bot.stop();
    await api.close();
    await boss.stop();
    await db.$disconnect();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  // Long polling for now. Resolves when the bot stops, and rejects on a bad token.
  await bot.start({ onStart: (me) => console.log(`Bot running as @${me.username}`) });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
