import { computeAwards, parseRules, type AwardInput, type Awards, type PlayerAward } from "@potbot/core";
import type { Gameweek, League, Member, PrismaClient } from "@potbot/db";
import type { FplClient } from "@potbot/fpl";
import { t, type Language } from "../i18n/index.js";
import { claimMessage, releaseMessage } from "./message-log.js";
import type { SettlementDeps } from "./settlement.js";

/** Awards as stored on a result, with player names resolved so showing them later needs no FPL call. */
export type StoredAwards = Omit<Awards, "captainCalamity" | "genius"> & {
  captainCalamity: (PlayerAward & { player: string }) | null;
  genius: (PlayerAward & { player: string }) | null;
};

/** Combines a gameweek's picks and live points with the stored scores, so a manual correction counts here too. */
export async function awardInputs(
  fpl: FplClient,
  input: {
    event: number;
    members: Pick<Member, "id" | "fplEntryId">[];
    scores: { memberId: number; points: number; transferCost: number; benchPoints: number }[];
    grossScores: boolean;
  },
): Promise<AwardInput[]> {
  const { event, members, scores, grossScores } = input;
  const [picks, live] = await Promise.all([
    fpl.getPicksForEntries(
      members.map((member) => member.fplEntryId),
      event,
    ),
    fpl.getEventLive(event),
  ]);
  const pointsOf = (element: number) => live.elements.find((item) => item.id === element)?.stats.total_points ?? 0;

  return scores.flatMap((score) => {
    const member = members.find((item) => item.id === score.memberId);
    if (!member) return [];
    const team = picks.get(member.fplEntryId)?.picks ?? [];
    // An auto-sub moves the multiplier, so whoever holds it is the real captain.
    const captain = team.find((pick) => pick.multiplier >= 2) ?? team.find((pick) => pick.is_captain);
    return [
      {
        memberId: score.memberId,
        net: grossScores ? score.points : score.points - score.transferCost,
        transferCost: score.transferCost,
        benchPoints: score.benchPoints,
        captain: captain ? { element: captain.element, points: pointsOf(captain.element) } : null,
        starters: team
          .filter((pick) => pick.multiplier > 0)
          .map((pick) => ({ element: pick.element, points: pointsOf(pick.element) })),
        allPicks: team.map((pick) => pick.element),
      },
    ];
  });
}

export async function storedAwards(fpl: FplClient, inputs: AwardInput[]): Promise<StoredAwards> {
  const { elements } = await fpl.getBootstrap();
  const nameOf = (element: number) => elements.find((item) => item.id === element)?.web_name ?? String(element);
  const awards = computeAwards(inputs);
  const withPlayer = (award: PlayerAward | null) => (award ? { ...award, player: nameOf(award.element) } : null);
  return { ...awards, captainCalamity: withPlayer(awards.captainCalamity), genius: withPlayer(awards.genius) };
}

export function awardLines(language: Language, gw: number, awards: StoredAwards, members: Member[]): string[] {
  const names = (ids: number[]) =>
    ids.map((id) => members.find((member) => member.id === id)?.fplManagerName ?? String(id)).join(" & ");

  const lines = [t(language, "awards.header", { gw })];
  const { woodenSpoon, benchBoss, captainCalamity, hitMan, genius } = awards;
  if (woodenSpoon) {
    lines.push(t(language, "awards.woodenSpoon", { names: names(woodenSpoon.memberIds), value: woodenSpoon.value }));
  }
  if (benchBoss) {
    lines.push(t(language, "awards.benchBoss", { names: names(benchBoss.memberIds), value: benchBoss.value }));
  }
  if (captainCalamity) {
    const vars = { names: names(captainCalamity.memberIds), value: captainCalamity.value };
    // Tied managers may have had different captains, so naming one player could be wrong.
    lines.push(
      captainCalamity.memberIds.length === 1
        ? t(language, "awards.captainCalamity", { ...vars, player: captainCalamity.player })
        : t(language, "awards.captainCalamityShared", vars),
    );
  }
  if (hitMan) lines.push(t(language, "awards.hitMan", { names: names(hitMan.memberIds), value: hitMan.value }));
  if (genius) {
    const vars = { names: names(genius.memberIds), value: genius.value };
    lines.push(
      genius.memberIds.length === 1
        ? t(language, "awards.genius", { ...vars, player: genius.player })
        : t(language, "awards.geniusShared", vars),
    );
  }
  return lines;
}

async function workOutAwards(db: PrismaClient, fpl: FplClient, league: League, gameweek: Gameweek, resultId: number) {
  const scores = await db.score.findMany({ where: { gameweekId: gameweek.id } });
  const members = await db.member.findMany({ where: { leagueId: league.id } });
  const inputs = await awardInputs(fpl, {
    event: gameweek.fplEventId,
    members,
    scores,
    grossScores: parseRules(league.rules).scoreMode === "gross",
  });

  for (const input of inputs) {
    await db.score.updateMany({
      where: { gameweekId: gameweek.id, memberId: input.memberId },
      data: { captainPoints: input.captain?.points ?? null },
    });
  }
  const awards = await storedAwards(fpl, inputs);
  await db.result.update({ where: { id: resultId }, data: { awards: awards as object } });
  return awards;
}

/** Works out and posts awards for gameweeks that settled from FPL data, once each. A failure retries next tick. */
export async function postPendingAwards({ db, fpl, send }: SettlementDeps, league: League): Promise<void> {
  const settled = await db.gameweek.findMany({
    where: { leagueId: league.id, status: "settled", finalSeenAt: { not: null } },
    include: { result: true },
    orderBy: { fplEventId: "asc" },
  });
  const members = await db.member.findMany({ where: { leagueId: league.id } });

  for (const gameweek of settled) {
    const { result } = gameweek;
    if (!result) continue;
    const key = `awards:gw${gameweek.fplEventId}`;
    const posted = await db.messageLog.findUnique({
      where: { leagueId_dedupeKey: { leagueId: league.id, dedupeKey: key } },
    });
    if (posted) continue;

    const awards =
      (result.awards as unknown as StoredAwards | null) ?? (await workOutAwards(db, fpl, league, gameweek, result.id));
    if (!(await claimMessage(db, league.id, key, "awards"))) continue;
    try {
      await send(league.telegramChatId, awardLines("en", gameweek.fplEventId, awards, members).join("\n"));
    } catch (error) {
      await releaseMessage(db, league.id, key);
      throw error;
    }
  }
}

export async function latestAwards(db: PrismaClient, league: League) {
  const gameweek = await db.gameweek.findFirst({
    where: { leagueId: league.id, result: { awards: { not: { equals: null } } } },
    include: { result: true },
    orderBy: { fplEventId: "desc" },
  });
  if (!gameweek?.result?.awards) return null;
  const members = await db.member.findMany({ where: { leagueId: league.id } });
  return { gw: gameweek.fplEventId, awards: gameweek.result.awards as unknown as StoredAwards, members };
}
