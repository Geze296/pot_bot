import { Bot, type BotConfig, type Context } from "grammy";
import { adminCommands } from "./commands/admin.js";
import { appCommands } from "./commands/app.js";
import { autoDeleteReplies } from "./commands/auto-delete.js";
import { banterCommands } from "./commands/banter.js";
import type { BotDeps } from "./commands/deps.js";
import { groupMigration } from "./commands/group-migration.js";
import { joinCommands } from "./commands/join.js";
import { linkCommands } from "./commands/link.js";
import { overrideCommands } from "./commands/override.js";
import { paymentCommands } from "./commands/payments.js";
import { payoutCommands } from "./commands/payouts.js";
import { rulesCommands } from "./commands/rules.js";
import { setupCommands } from "./commands/setup.js";
import { statusCommands } from "./commands/status.js";
import { t, toLanguage } from "./i18n/index.js";

export function createBot(token: string, deps: BotDeps, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);

  // A boundary rather than bot.catch, which only works with long polling. With a webhook, an uncaught error would
  // answer Telegram with a 500, and Telegram would keep sending the same update.
  const app = bot.errorBoundary(async (error) => {
    console.error("Error handling update:", error.error);
    try {
      await error.ctx.reply(t(toLanguage(error.ctx.from?.language_code), "common.error"));
    } catch {
      // Telegram itself may be the problem, and there's no one else to tell.
    }
  });

  app.use(autoDeleteReplies(deps.scheduleDeletion));

  app.use(groupMigration(deps));
  app.use(joinCommands(deps));
  app.use(adminCommands(deps));
  app.use(appCommands(deps));
  app.use(setupCommands(deps));
  app.use(linkCommands(deps));
  app.use(overrideCommands(deps));
  app.use(payoutCommands(deps));
  app.use(rulesCommands(deps));
  app.use(statusCommands(deps));

  app.command("help", (ctx) =>
    ctx.reply(t(toLanguage(ctx.from?.language_code), "help.text", { bot: `@${ctx.me.username}` })),
  );

  app.command("start", (ctx) =>
    ctx.reply(t(toLanguage(ctx.from?.language_code), "start.welcome", { name: ctx.from?.first_name ?? "" })),
  );

  // Last, so it only sees messages no command has handled.
  app.use(paymentCommands(deps));
  app.use(banterCommands(deps));

  return bot;
}
