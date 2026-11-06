import { Composer, InlineKeyboard, type Context } from "grammy";
import { t, toLanguage } from "../i18n/index.js";
import type { BotDeps } from "./deps.js";

const START_PAYLOAD = "app";

/**
 * Points the bot's menu button at the app, or clears it with no address, so a button left over from an old tunnel
 * doesn't lead nowhere. The bot works without it, so a failure here doesn't stop startup.
 */
export async function syncMenuButton(
  api: { setChatMenuButton: (options: never) => Promise<unknown> },
  webAppUrl: string | undefined,
): Promise<void> {
  const menu_button = webAppUrl
    ? { type: "web_app", text: t("en", "app.menu"), web_app: { url: webAppUrl } }
    : { type: "default" };
  try {
    await api.setChatMenuButton({ menu_button } as never);
  } catch (error) {
    console.error("Couldn't set the menu button:", error);
  }
}

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
