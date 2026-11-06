import type { League, Member } from "@potbot/db";
import { Composer, InlineKeyboard, type Context } from "grammy";
import { t, toLanguage, type Language } from "../i18n/index.js";
import { aiLine, mentionPrompt, personaSettings, PERSONAS, roastPrompt, type PersonaName } from "../services/banter.js";
import { leagueLedger } from "../services/ledger.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { displayName, ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";

export function banterCommands(deps: BotDeps): Composer<Context> {
  const { db } = deps;
  const composer = new Composer<Context>();
  const now = () => deps.now?.() ?? new Date();

  const groupLeague = async (ctx: Context) => {
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat!.id) } });
    return league?.setupState === SETUP_STATE.active ? league : null;
  };

  /** The group's league, if the sender may manage it. Otherwise replies and returns nothing. */
  async function asManager(ctx: Context, language: Language) {
    const league = await groupLeague(ctx);
    if (!league) {
      await ctx.reply(t(language, "common.noLeague"));
      return undefined;
    }
    const actor = await ensureUser(db, ctx.from!);
    if (actor.id !== league.ownerUserId && actor.id !== league.coordinatorUserId) {
      await ctx.reply(t(language, "override.denied"));
      return undefined;
    }
    return { league, actor };
  }

  /** Who a command means: the person replied to, an @username, or an FPL team ID. */
  async function targetMember(ctx: Context, league: League, argument: string): Promise<Member | null> {
    const replied = ctx.message?.reply_to_message?.from;
    if (replied) {
      return db.member.findFirst({ where: { leagueId: league.id, user: { telegramId: BigInt(replied.id) } } });
    }
    if (argument.startsWith("@")) {
      const username = argument.slice(1);
      return db.member.findFirst({
        where: { leagueId: league.id, user: { username: { equals: username, mode: "insensitive" } } },
      });
    }
    if (/^\d+$/.test(argument)) {
      return db.member.findUnique({
        where: { leagueId_fplEntryId: { leagueId: league.id, fplEntryId: Number(argument) } },
      });
    }
    return null;
  }

  composer.command("roast", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    if (ctx.chat.type === "private") return ctx.reply(t(language, "roast.groupOnly"));
    const manager = await asManager(ctx, language);
    if (!manager) return;
    const { league } = manager;

    const found = await targetMember(ctx, league, ctx.match.trim());
    if (!found) return ctx.reply(t(language, "roast.usage"));
    if (found.roastOptOut) return ctx.reply(t(language, "roast.optedOut"));

    const member = await db.member.findUniqueOrThrow({ where: { id: found.id }, include: { facts: true } });
    const score = await db.score.findFirst({
      where: { memberId: member.id },
      include: { gameweek: true },
      orderBy: { gameweek: { fplEventId: "desc" } },
    });
    const latest = score
      ? {
          event: score.gameweek.fplEventId,
          net: score.points - score.transferCost,
          hits: score.transferCost,
          bench: score.benchPoints,
          captainPoints: score.captainPoints,
        }
      : null;

    const line = await aiLine(deps, league, roastPrompt(member, latest), now());
    return ctx.reply(line ?? t(language, "roast.template", { name: member.fplManagerName }));
  });

  composer.command("nofun", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const user = await ensureUser(db, ctx.from!);
    const { count } = await db.member.updateMany({ where: { userId: user.id }, data: { roastOptOut: true } });
    return ctx.reply(t(language, count > 0 ? "nofun.done" : "nofun.noTeam"));
  });

  composer.command("funon", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const user = await ensureUser(db, ctx.from!);
    const { count } = await db.member.updateMany({ where: { userId: user.id }, data: { roastOptOut: false } });
    return ctx.reply(t(language, count > 0 ? "funon.done" : "nofun.noTeam"));
  });

  composer.command("fact", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const manager = await asManager(ctx, language);
    if (!manager) return;

    const [teamText, ...rest] = ctx.match.trim().split(/\s+/);
    const fact = rest.join(" ");
    if (!teamText || !/^\d+$/.test(teamText) || !fact) return ctx.reply(t(language, "fact.usage"));

    const member = await db.member.findUnique({
      where: { leagueId_fplEntryId: { leagueId: manager.league.id, fplEntryId: Number(teamText) } },
    });
    if (!member) return ctx.reply(t(language, "override.noTeam", { id: teamText }));
    if (member.roastOptOut) return ctx.reply(t(language, "roast.optedOut"));

    const saved = await db.memberFact.create({ data: { memberId: member.id, fact, source: "admin" } });
    await db.auditLog.create({
      data: {
        leagueId: manager.league.id,
        actorId: manager.actor.id,
        action: "fact.add",
        entity: "member_fact",
        entityId: saved.id,
        after: { memberId: member.id },
      },
    });
    return ctx.reply(t(language, "fact.saved", { name: member.fplManagerName }));
  });

  composer.command("persona", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const manager = await asManager(ctx, language);
    if (!manager) return;
    const { league, actor } = manager;
    const current = personaSettings(league);

    const [name, spiceText] = ctx.match.trim().split(/\s+/);
    if (!name) {
      return ctx.reply(
        t(language, "persona.current", { name: current.name, spice: current.spice, options: PERSONAS.join(", ") }),
      );
    }
    const spice = spiceText === undefined ? current.spice : Number(spiceText);
    if (!PERSONAS.includes(name as PersonaName) || !Number.isInteger(spice) || spice < 1 || spice > 5) {
      return ctx.reply(t(language, "persona.usage", { options: PERSONAS.join(", ") }));
    }

    const updated = { ...current, name: name as PersonaName, spice };
    await db.$transaction([
      db.league.update({ where: { id: league.id }, data: { persona: { ...updated } } }),
      db.auditLog.create({
        data: {
          leagueId: league.id,
          actorId: actor.id,
          action: "persona.update",
          entity: "league",
          entityId: league.id,
          before: { ...current },
          after: { ...updated },
        },
      }),
    ]);
    return ctx.reply(t(language, "persona.saved", { name, spice }));
  });

  function meKeyboard(language: Language, facts: { id: number }[]) {
    const keyboard = new InlineKeyboard();
    facts.forEach(({ id }, index) => {
      keyboard.text(t(language, "me.deleteOne", { number: index + 1 }), `fact:del:${id}`).row();
    });
    if (facts.length > 1) keyboard.text(t(language, "me.deleteAll"), "fact:clear");
    return keyboard;
  }

  async function meFor(language: Language, telegramId: number) {
    const members = await db.member.findMany({
      where: { user: { telegramId: BigInt(telegramId) } },
      include: { league: true, facts: { orderBy: { createdAt: "asc" } } },
    });
    if (members.length === 0) return null;

    const lines: string[] = [];
    const facts = members.flatMap((member) => member.facts);
    for (const member of members) {
      const { members: rows } = await leagueLedger(db, member.leagueId);
      const row = rows.find((item) => item.memberId === member.id);
      lines.push(
        t(language, "me.league", {
          league: member.league.name,
          team: member.fplTeamName,
          paid: row?.paidIn ?? 0,
          won: row?.won ?? 0,
          net: row?.net ?? 0,
        }),
      );
      if (member.roastOptOut) lines.push(t(language, "me.optedOut"));
    }
    lines.push("");
    if (facts.length > 0) {
      lines.push(t(language, "me.factsHeader"));
      facts.forEach((item, index) => lines.push(`${index + 1}. ${item.fact}`));
    } else {
      lines.push(t(language, "me.noFacts"));
    }
    return { text: lines.join("\n"), facts };
  }

  composer.command("me", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    if (ctx.chat.type !== "private") return ctx.reply(t(language, "me.privateOnly"));
    const me = await meFor(language, ctx.from!.id);
    if (!me) return ctx.reply(t(language, "payments.notLinked"));
    return ctx.reply(me.text, { reply_markup: meKeyboard(language, me.facts) });
  });

  // Only ever acts on the sender's own facts (PRD F3).
  composer.callbackQuery(/^fact:(del:(\d+)|clear)$/, async (ctx) => {
    const language = toLanguage(ctx.from.language_code);
    const mine = { member: { user: { telegramId: BigInt(ctx.from.id) } } };
    const id = ctx.match[2];
    await db.memberFact.deleteMany({ where: id ? { id: Number(id), ...mine } : mine });
    await ctx.answerCallbackQuery({ text: t(language, "me.deleted") });

    const me = await meFor(language, ctx.from.id);
    if (me) await ctx.editMessageText(me.text, { reply_markup: meKeyboard(language, me.facts) });
  });

  // Runs after everything else, so commands and payment photos are already handled.
  composer.on("message:text", async (ctx, next) => {
    if (ctx.chat.type === "private") return next();

    const mentioned = (ctx.message.entities ?? []).some(
      (entity) =>
        entity.type === "mention" &&
        ctx.message.text.slice(entity.offset, entity.offset + entity.length).toLowerCase() ===
          `@${ctx.me.username.toLowerCase()}`,
    );
    const repliedToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
    if (!mentioned && !repliedToBot) return next();

    const league = await groupLeague(ctx);
    if (!league) return next();

    const scores = await db.score.findMany({
      where: { gameweek: { leagueId: league.id } },
      include: { gameweek: true, member: true },
      orderBy: { gameweek: { fplEventId: "desc" } },
      take: 40,
    });
    const latestEvent = scores[0]?.gameweek.fplEventId;
    const table = scores
      .filter((score) => score.gameweek.fplEventId === latestEvent)
      .map((score) => `${score.member.fplManagerName}: ${score.points - score.transferCost}`)
      .join("\n");

    const language = toLanguage(ctx.from.language_code);
    const line = await aiLine(
      deps,
      league,
      mentionPrompt(displayName(ctx.from), ctx.message.text, table),
      now(),
      "ai_mention",
    );
    return ctx.reply(line ?? t(language, "banter.template", { bot: `@${ctx.me.username}` }));
  });

  return composer;
}
