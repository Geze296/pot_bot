import { Bot, type BotConfig, type Context } from "grammy";
import { t, toLanguage } from "./i18n/index.js";

export function createBot(token: string, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);

  bot.command("start", (ctx) =>
    ctx.reply(t(toLanguage(ctx.from?.language_code), "start.welcome", { name: ctx.from?.first_name ?? "" })),
  );

  return bot;
}
