import { Bot, type BotConfig, type Context } from "grammy";
import type { BotDeps } from "./commands/deps.js";
import { joinCommands } from "./commands/join.js";
import { linkCommands } from "./commands/link.js";
import { overrideCommands } from "./commands/override.js";
import { paymentCommands } from "./commands/payments.js";
import { rulesCommands } from "./commands/rules.js";
import { setupCommands } from "./commands/setup.js";
import { statusCommands } from "./commands/status.js";
import { t, toLanguage } from "./i18n/index.js";

export function createBot(token: string, deps: BotDeps, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);

  bot.use(joinCommands(deps));
  bot.use(setupCommands(deps));
  bot.use(linkCommands(deps));
  bot.use(overrideCommands(deps));
  bot.use(rulesCommands(deps));
  bot.use(statusCommands(deps));

  bot.command("start", (ctx) =>
    ctx.reply(t(toLanguage(ctx.from?.language_code), "start.welcome", { name: ctx.from?.first_name ?? "" })),
  );

  // Last, so it only sees messages no command has handled.
  bot.use(paymentCommands(deps));

  // A failure handling one update must not stop the bot for everyone else.
  bot.catch((error) => console.error("Error handling update:", error.error));

  return bot;
}
