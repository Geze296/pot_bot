import { parseRules, RuleError, setRule, type LeagueRules } from "@potbot/core";
import { Composer, type Context } from "grammy";
import { t, toLanguage } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { displayName, ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";

export function rulesCommands({ db }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  const activeLeague = async (ctx: Context) => {
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat!.id) } });
    return league?.setupState === SETUP_STATE.active ? league : null;
  };

  composer.command("rules", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const league = await activeLeague(ctx);
    if (!league) return ctx.reply(t(language, "common.noLeague"));

    const rules = Object.entries(parseRules(league.rules))
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("\n");
    return ctx.reply(t(language, "rules.list", { rules }));
  });

  composer.command("setrule", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const league = await activeLeague(ctx);
    if (!league) return ctx.reply(t(language, "common.noLeague"));
    const actor = await ensureUser(db, ctx.from!);
    if (actor.id !== league.ownerUserId) return ctx.reply(t(language, "common.ownerOnly"));

    const [key, value] = ctx.match.trim().split(/\s+/);
    if (!key || !value) return ctx.reply(t(language, "rules.usage"));

    const before = parseRules(league.rules);
    let after: LeagueRules;
    try {
      after = setRule(before, key, value);
    } catch (error) {
      if (error instanceof RuleError) return ctx.reply(t(language, "rules.invalid", { key }));
      throw error;
    }

    await db.$transaction([
      db.league.update({ where: { id: league.id }, data: { rules: { ...after } } }),
      db.auditLog.create({
        data: {
          leagueId: league.id,
          actorId: actor.id,
          action: "rules.update",
          entity: "league",
          entityId: league.id,
          before: { [key]: before[key as keyof LeagueRules] },
          after: { [key]: after[key as keyof LeagueRules] },
        },
      }),
    ]);
    return ctx.reply(t(language, "rules.saved", { key, value }));
  });

  composer.command("coordinator", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const league = await activeLeague(ctx);
    if (!league) return ctx.reply(t(language, "common.noLeague"));
    const actor = await ensureUser(db, ctx.from!);
    if (actor.id !== league.ownerUserId) return ctx.reply(t(language, "common.ownerOnly"));

    const target = ctx.message?.reply_to_message?.from;
    if (!target || target.is_bot) return ctx.reply(t(language, "coordinator.usage"));

    const coordinator = await ensureUser(db, target);
    await db.$transaction([
      db.league.update({ where: { id: league.id }, data: { coordinatorUserId: coordinator.id } }),
      db.auditLog.create({
        data: {
          leagueId: league.id,
          actorId: actor.id,
          action: "coordinator.set",
          entity: "league",
          entityId: league.id,
          before: { coordinatorUserId: league.coordinatorUserId },
          after: { coordinatorUserId: coordinator.id },
        },
      }),
    ]);
    return ctx.reply(t(language, "coordinator.done", { name: displayName(target) }));
  });

  return composer;
}
