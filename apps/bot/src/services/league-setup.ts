import { randomBytes } from "node:crypto";
import { DEFAULT_RULES, rankGameweek, type GameweekRanking } from "@potbot/core";
import type { GameweekStatus, League, PrismaClient } from "@potbot/db";
import type { FplClient, FplEntryHistory, FplEvent, LeagueStandings } from "@potbot/fpl";

export const SETUP_STATE = {
  awaitingConfirm: "awaiting_confirm",
  backfilling: "backfilling",
  active: "active",
} as const;

/** Creates or replaces the unconfirmed league for a group. An active league is never replaced. */
export async function prepareLeague(
  db: PrismaClient,
  input: { chatId: number; ownerUserId: number; standings: LeagueStandings; firstPotGw: number | null },
): Promise<League> {
  const { league: fplLeague, managers } = input.standings;
  const telegramChatId = BigInt(input.chatId);

  return db.$transaction(async (tx) => {
    const existing = await tx.league.findUnique({ where: { telegramChatId } });
    if (existing) {
      await tx.member.deleteMany({ where: { leagueId: existing.id } });
      await tx.league.delete({ where: { id: existing.id } });
    }

    return tx.league.create({
      data: {
        name: fplLeague.name,
        telegramChatId,
        fplLeagueId: fplLeague.id,
        ownerUserId: input.ownerUserId,
        firstPotGw: input.firstPotGw,
        rules: { ...DEFAULT_RULES },
        persona: {},
        setupState: SETUP_STATE.awaitingConfirm,
        joinToken: randomBytes(16).toString("hex"),
        members: {
          create: managers.map((manager) => ({
            fplEntryId: manager.entry,
            fplTeamName: manager.teamName,
            fplManagerName: manager.managerName,
          })),
        },
      },
    });
  });
}

export async function cancelLeague(db: PrismaClient, leagueId: number): Promise<void> {
  await db.$transaction([db.member.deleteMany({ where: { leagueId } }), db.league.delete({ where: { id: leagueId } })]);
}

/** Pairs a gameweek's FPL history with member ids. A manager who hadn't started that gameweek is left out. */
export function scoresForEvent(
  eventId: number,
  members: { id: number; fplEntryId: number }[],
  histories: Map<number, FplEntryHistory>,
) {
  return members.flatMap((member) => {
    const week = histories.get(member.fplEntryId)?.current.find((row) => row.event === eventId);
    if (!week) return [];
    return [
      {
        id: member.id,
        points: week.points,
        transferCost: week.event_transfers_cost,
        benchPoints: week.points_on_bench,
      },
    ];
  });
}

function statusForEvent(event: FplEvent, hasResult: boolean): GameweekStatus {
  if (hasResult) return "settled";
  if (event.finished) return "finished";
  return event.is_current ? "live" : "open";
}

/** The payment window opens at the previous gameweek's deadline. GW1 has none, so it gets a week. */
function paymentOpensAt(event: FplEvent, events: FplEvent[]): Date {
  const previous = events.find((other) => other.id === event.id - 1);
  if (previous) return new Date(previous.deadline_time);
  return new Date(new Date(event.deadline_time).getTime() - 7 * 24 * 60 * 60 * 1000);
}

export interface SeasonWeek {
  eventId: number;
  ranking: GameweekRanking;
}

export interface BackfillSummary {
  season: SeasonWeek[];
  seedFreePassMemberIds: number[];
  events: FplEvent[];
}

/**
 * Creates the league's gameweeks from firstPotGw on and records every finished one, then seeds the free pass
 * from the gameweek before it. Safe to run twice, and it never overwrites a manual score or result (hard rule 8).
 * Money for backfilled gameweeks is left at 0 until obligations arrive in Milestone M2.
 */
export async function backfillSeason(
  db: PrismaClient,
  fpl: FplClient,
  input: { leagueId: number; firstPotGw: number },
): Promise<BackfillSummary> {
  const { leagueId, firstPotGw } = input;
  const { events } = await fpl.getBootstrap();
  const members = await db.member.findMany({ where: { leagueId } });

  const potEvents = events.filter((event) => event.id >= firstPotGw);
  const finished = potEvents.filter((event) => event.finished);
  const previous = events.find((event) => event.id === firstPotGw - 1 && event.finished);

  const needsHistory = finished.length > 0 || previous !== undefined;
  const histories = needsHistory
    ? await fpl.getEntryHistories(members.map((member) => member.fplEntryId))
    : new Map<number, FplEntryHistory>();

  const season: SeasonWeek[] = [];
  for (const event of finished) {
    const rows = scoresForEvent(event.id, members, histories);
    if (rows.length > 0) season.push({ eventId: event.id, ranking: rankGameweek(rows) });
  }
  const seedFreePassMemberIds = previous
    ? rankGameweek(scoresForEvent(previous.id, members, histories)).runnerUpIds
    : [];

  await db.$transaction(async (tx) => {
    for (const event of potEvents) {
      const week = season.find((item) => item.eventId === event.id);
      const status = statusForEvent(event, week !== undefined);
      const gameweek = await tx.gameweek.upsert({
        where: { leagueId_fplEventId: { leagueId, fplEventId: event.id } },
        create: {
          leagueId,
          fplEventId: event.id,
          deadlineAt: new Date(event.deadline_time),
          paymentOpensAt: paymentOpensAt(event, events),
          paymentClosesAt: new Date(event.deadline_time),
          status,
        },
        update: {},
      });
      if (!week) continue;

      for (const row of scoresForEvent(event.id, members, histories)) {
        const rank = week.ranking.standings.find((standing) => standing.id === row.id)?.rank;
        const scoreData = {
          points: row.points,
          transferCost: row.transferCost,
          benchPoints: row.benchPoints,
          rankInGw: rank,
        };
        const existing = await tx.score.findUnique({
          where: { gameweekId_memberId: { gameweekId: gameweek.id, memberId: row.id } },
        });
        if (!existing) {
          await tx.score.create({ data: { gameweekId: gameweek.id, memberId: row.id, ...scoreData } });
        } else if (existing.source !== "manual") {
          await tx.score.update({ where: { id: existing.id }, data: scoreData });
        }
      }

      const resultData = {
        winnerMemberIds: week.ranking.winnerIds,
        runnerUpMemberIds: week.ranking.runnerUpIds,
        payoutAmount: 0,
      };
      const result = await tx.result.findUnique({ where: { gameweekId: gameweek.id } });
      if (!result) {
        await tx.result.create({ data: { gameweekId: gameweek.id, ...resultData } });
      } else if (result.source !== "manual") {
        await tx.result.update({ where: { id: result.id }, data: resultData });
      }
    }

    await tx.league.update({
      where: { id: leagueId },
      data: { firstPotGw, seedFreePassMemberIds, setupState: SETUP_STATE.active },
    });
  });

  return { season, seedFreePassMemberIds, events };
}
