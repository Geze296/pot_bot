import { Composer, type Context } from "grammy";
import { t, toLanguage } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";

/** The owner's and coordinator's own command list, kept out of /help so members see only what they need. */
export function adminCommands({ db }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  composer.command("admin", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const user = await ensureUser(db, ctx.from!);
    const manages = { OR: [{ ownerUserId: user.id }, { coordinatorUserId: user.id }] };
    const leagues = await db.league.findMany({
      where:
        ctx.chat.type === "private"
          ? { setupState: SETUP_STATE.active, ...manages }
          : { telegramChatId: BigInt(ctx.chat.id), ...manages },
    });
    return ctx.reply(t(language, leagues.length > 0 ? "admin.text" : "override.denied"));
  });

  return composer;
}
