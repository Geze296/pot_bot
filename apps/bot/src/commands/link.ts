import { Composer, type Context } from "grammy";
import type { League, User } from "@potbot/db";
import { t, toLanguage } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { displayName, ensureUser, isUniqueViolation } from "../services/users.js";
import type { BotDeps } from "./deps.js";

export function linkCommands({ db }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  /** The group's active league and acting user, or a reply explaining why not. */
  async function asOwner(ctx: Context): Promise<{ league: League; actor: User } | undefined> {
    const language = toLanguage(ctx.from?.language_code);
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat!.id) } });
    if (!league || league.setupState !== SETUP_STATE.active) {
      await ctx.reply(t(language, "common.noLeague"));
      return undefined;
    }
    const actor = await ensureUser(db, ctx.from!);
    if (league.ownerUserId !== actor.id) {
      await ctx.reply(t(language, "common.ownerOnly"));
      return undefined;
    }
    return { league, actor };
  }

  composer.command("link", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const owner = await asOwner(ctx);
    if (!owner) return;

    const target = ctx.message?.reply_to_message?.from;
    const entryId = Number(ctx.match);
    if (!target || target.is_bot || !Number.isInteger(entryId) || entryId <= 0) {
      return ctx.reply(t(language, "link.usage"));
    }

    const member = await db.member.findUnique({
      where: { leagueId_fplEntryId: { leagueId: owner.league.id, fplEntryId: entryId } },
    });
    if (!member) return ctx.reply(t(language, "link.notFound", { id: entryId }));
    if (member.userId !== null) {
      return ctx.reply(t(language, "link.alreadyLinked", { team: member.fplTeamName, id: entryId }));
    }

    const user = await ensureUser(db, target);
    try {
      await db.$transaction([
        db.member.update({ where: { id: member.id }, data: { userId: user.id } }),
        db.auditLog.create({
          data: {
            leagueId: owner.league.id,
            actorId: owner.actor.id,
            action: "member.link",
            entity: "member",
            entityId: member.id,
            before: { userId: null },
            after: { userId: user.id },
          },
        }),
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) return ctx.reply(t(language, "link.userHasTeam"));
      throw error;
    }
    return ctx.reply(t(language, "link.done", { name: displayName(target), team: member.fplTeamName }));
  });

  composer.command("unlink", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const owner = await asOwner(ctx);
    if (!owner) return;

    const entryId = Number(ctx.match);
    if (!ctx.match || !Number.isInteger(entryId) || entryId <= 0) return ctx.reply(t(language, "unlink.usage"));

    const member = await db.member.findUnique({
      where: { leagueId_fplEntryId: { leagueId: owner.league.id, fplEntryId: entryId } },
    });
    if (!member) return ctx.reply(t(language, "link.notFound", { id: entryId }));
    if (member.userId === null) return ctx.reply(t(language, "unlink.notLinked", { team: member.fplTeamName }));

    await db.$transaction([
      db.member.update({ where: { id: member.id }, data: { userId: null } }),
      db.auditLog.create({
        data: {
          leagueId: owner.league.id,
          actorId: owner.actor.id,
          action: "member.unlink",
          entity: "member",
          entityId: member.id,
          before: { userId: member.userId },
          after: { userId: null },
        },
      }),
    ]);
    return ctx.reply(t(language, "unlink.done", { team: member.fplTeamName }));
  });

  return composer;
}
