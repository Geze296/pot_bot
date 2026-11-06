import { Composer, InlineKeyboard, type Context } from "grammy";
import { t, toLanguage } from "../i18n/index.js";
import type { BotDeps } from "./deps.js";

const START_PAYLOAD = "app";

export function appCommands({ webAppUrl }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  const showButton = (ctx: Context) => {
    const language = toLanguage(ctx.from?.language_code);
    if (!webAppUrl) return ctx.reply(t(language, "app.notAvailable"));
    return ctx.reply(t(language, "app.prompt"), {
      reply_markup: new InlineKeyboard().webApp(t(language, "app.open"), webAppUrl),
    });
  };

  composer.command("start", async (ctx, next) => (ctx.match === START_PAYLOAD ? showButton(ctx) : next()));

  composer.command("app", async (ctx) => {
    if (ctx.chat.type === "private") return showButton(ctx);

    // Telegram doesn't allow app buttons in groups, so this leads to the private chat, which shows one.
    const language = toLanguage(ctx.from?.language_code);
    if (!webAppUrl) return ctx.reply(t(language, "app.notAvailable"));
    return ctx.reply(t(language, "app.private"), {
      reply_markup: new InlineKeyboard().url(
        t(language, "app.open"),
        `https://t.me/${ctx.me.username}?start=${START_PAYLOAD}`,
      ),
    });
  });

  return composer;
}
