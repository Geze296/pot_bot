import { Composer, InlineKeyboard, type Context } from "grammy";
import type { League, Member, PrismaClient } from "@potbot/db";
import { t, toLanguage, type Language } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { ensureUser, isUniqueViolation } from "../services/users.js";
import type { BotDeps } from "./deps.js";

const JOIN_PREFIX = "join_";

const unclaimedMembers = (db: PrismaClient, leagueId: number): Promise<Member[]> =>
  db.member.findMany({
    where: { leagueId, userId: null, status: { not: "left" } },
    orderBy: { fplTeamName: "asc" },
  });

function teamKeyboard(members: Member[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const member of members) {
    keyboard.text(`${member.fplTeamName} (${member.fplManagerName})`, `claim:${member.id}`).row();
  }
  return keyboard;
}

export function joinCommands({ db }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();

  async function showTeams(ctx: Context, language: Language, league: League, edit: boolean) {
    const teams = await unclaimedMembers(db, league.id);
    const text = t(language, teams.length > 0 ? "join.pick" : "join.none", { league: league.name });
    const options = teams.length > 0 ? { reply_markup: teamKeyboard(teams) } : {};
    return edit ? ctx.editMessageText(text, options) : ctx.reply(text, options);
  }

  composer.command("start", async (ctx, next) => {
    if (!ctx.match.startsWith(JOIN_PREFIX)) return next();
    const language = toLanguage(ctx.from?.language_code);

    const league = await db.league.findUnique({ where: { joinToken: ctx.match.slice(JOIN_PREFIX.length) } });
    if (!league || league.setupState !== SETUP_STATE.active) return ctx.reply(t(language, "join.invalid"));

    const user = await ensureUser(db, ctx.from!);
    const claimed = await db.member.findFirst({ where: { leagueId: league.id, userId: user.id } });
    if (claimed) {
      return ctx.reply(t(language, "join.alreadyClaimed", { team: claimed.fplTeamName, league: league.name }));
    }
    return showTeams(ctx, language, league, false);
  });

  composer.callbackQuery(/^claim:(\d+)$/, async (ctx) => {
    const language = toLanguage(ctx.from.language_code);
    const member = await db.member.findUnique({
      where: { id: Number(ctx.match[1]) },
      include: { league: true },
    });
    if (!member) return ctx.answerCallbackQuery();
    const user = await ensureUser(db, ctx.from);

    try {
      // The userId: null condition makes this safe when two people tap the same team at once.
      const { count } = await db.member.updateMany({
        where: { id: member.id, userId: null },
        data: { userId: user.id },
      });
      if (count === 0) {
        await ctx.answerCallbackQuery({ text: t(language, "join.taken"), show_alert: true });
        return showTeams(ctx, language, member.league, true);
      }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const claimed = await db.member.findFirst({ where: { leagueId: member.leagueId, userId: user.id } });
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(
        t(language, "join.alreadyClaimed", { team: claimed?.fplTeamName ?? "", league: member.league.name }),
      );
    }

    await ctx.answerCallbackQuery();
    return ctx.editMessageText(t(language, "join.success", { team: member.fplTeamName, league: member.league.name }));
  });

  return composer;
}
