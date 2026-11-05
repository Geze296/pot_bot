import { Composer, type Context } from "grammy";
import type { League, User } from "@potbot/db";
import { t, toLanguage } from "../i18n/index.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { overrideScore, overrideWinner } from "../services/settlement.js";
import { ensureUser } from "../services/users.js";
import type { BotDeps } from "./deps.js";

const isCount = (text: string | undefined): text is string => text !== undefined && /^\d+$/.test(text);
const teamIds = (text: string | undefined): number[] =>
  isCount(text?.replace(/,/g, "")) ? text!.split(",").filter(Boolean).map(Number) : [];

export function overrideCommands({ db }: BotDeps): Composer<Context> {
  const composer = new Composer<Context>();
  const send = (chatId: bigint, text: string, ctx: Context) => ctx.api.sendMessage(Number(chatId), text);

  /** The group's active league, if the sender is its owner or coordinator. Otherwise replies and returns nothing. */
  async function asManager(ctx: Context): Promise<{ league: League; actor: User } | undefined> {
    const language = toLanguage(ctx.from?.language_code);
    const league = await db.league.findUnique({ where: { telegramChatId: BigInt(ctx.chat!.id) } });
    if (!league || league.setupState !== SETUP_STATE.active) {
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

  composer.command("override", async (ctx) => {
    const language = toLanguage(ctx.from?.language_code);
    const manager = await asManager(ctx);
    if (!manager) return;
    const { league, actor } = manager;
    const deps = { db, send: (chatId: bigint, text: string) => send(chatId, text, ctx) };

    const [kind, ...args] = ctx.match.trim().split(/\s+/);
    const usage = () => ctx.reply(t(language, "override.usage"));
    const findGameweek = (gw: number) =>
      db.gameweek.findUnique({ where: { leagueId_fplEventId: { leagueId: league.id, fplEventId: gw } } });
    const findMembers = (ids: number[]) =>
      db.member.findMany({ where: { leagueId: league.id, fplEntryId: { in: ids } } });

    if (kind === "score") {
      const [team, gwText, pointsText, costText = "0"] = args;
      if (!isCount(team) || !isCount(gwText) || !isCount(pointsText) || !isCount(costText)) return usage();

      const gw = Number(gwText);
      const gameweek = await findGameweek(gw);
      if (!gameweek) return ctx.reply(t(language, "override.noGameweek", { gw }));
      const [member] = await findMembers([Number(team)]);
      if (!member) return ctx.reply(t(language, "override.noTeam", { id: team }));

      const points = Number(pointsText);
      const cost = Number(costText);
      const { corrected } = await overrideScore(deps, {
        league,
        gameweek,
        member,
        points,
        transferCost: cost,
        actorId: actor.id,
      });
      if (corrected) return;
      return ctx.reply(t(language, "override.scoreSaved", { team: member.fplTeamName, points, cost, gw }));
    }

    if (kind === "winner") {
      const [gwText, winnersText, runnerWord, runnersText] = args;
      const winners = teamIds(winnersText);
      const runners = teamIds(runnersText);
      const badRunner = runnerWord !== undefined && (runnerWord !== "runner" || runners.length === 0);
      if (!isCount(gwText) || winners.length === 0 || badRunner) return usage();

      const gw = Number(gwText);
      const gameweek = await findGameweek(gw);
      if (!gameweek) return ctx.reply(t(language, "override.noGameweek", { gw }));
      if (gameweek.status === "open") return ctx.reply(t(language, "override.notStarted", { gw }));

      const named = [...winners, ...runners];
      const members = await findMembers(named);
      const missing = named.find((id) => !members.some((member) => member.fplEntryId === id));
      if (missing !== undefined) return ctx.reply(t(language, "override.noTeam", { id: missing }));
      const idsOf = (entries: number[]) =>
        entries.map((entry) => members.find((member) => member.fplEntryId === entry)!.id);

      await overrideWinner(deps, {
        league,
        gameweek,
        winnerIds: idsOf(winners),
        runnerUpIds: idsOf(runners),
        actorId: actor.id,
      });
      return;
    }

    return usage();
  });

  return composer;
}
