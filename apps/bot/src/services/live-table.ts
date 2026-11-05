import { parseRules, rankGameweek } from "@potbot/core";
import type { League, PrismaClient } from "@potbot/db";
import type { FplClient, FplEntryHistory } from "@potbot/fpl";

const CACHE_MS = 5 * 60 * 1000;

export interface TableRow {
  team: string;
  value: number;
  rank: number;
}

export interface LiveTable {
  event: number;
  finished: boolean;
  gameweek: TableRow[];
  overall: TableRow[];
}

interface CachedHistories {
  histories: Map<number, FplEntryHistory>;
  fetchedAt: number;
}

/**
 * Builds the tables from each manager's history, because the league standings' event_total is before hits. A busy
 * chat shouldn't mean a burst of FPL calls per /table, so each league's histories are cached for 5 minutes.
 */
export function createLiveTables(db: PrismaClient, fpl: FplClient, now: () => number) {
  const cache = new Map<number, CachedHistories>();

  return async function liveTable(league: League): Promise<LiveTable | null> {
    const { events } = await fpl.getBootstrap();
    const event = events.find((item) => item.is_current);
    if (!event) return null;

    const members = await db.member.findMany({ where: { leagueId: league.id, status: { not: "left" } } });
    const cached = cache.get(league.id);
    const fresh = cached && now() - cached.fetchedAt < CACHE_MS;
    const histories = fresh
      ? cached.histories
      : await fpl.getEntryHistories(members.map((member) => member.fplEntryId));
    if (!fresh) cache.set(league.id, { histories, fetchedAt: now() });

    // A manual correction wins over FPL everywhere it's shown (hard rule 8).
    const manual = await db.score.findMany({
      where: { source: "manual", gameweek: { leagueId: league.id, fplEventId: event.id } },
    });

    const rules = parseRules(league.rules);
    const rows = members.flatMap((member) => {
      const week = histories.get(member.fplEntryId)?.current.find((row) => row.event === event.id);
      const override = manual.find((score) => score.memberId === member.id);
      if (!week && !override) return [];
      const points = override?.points ?? week!.points;
      const cost = override?.transferCost ?? week!.event_transfers_cost;
      return [{ id: member.id, points, transferCost: rules.scoreMode === "net" ? cost : 0 }];
    });
    const teamOf = (id: number) => members.find((member) => member.id === id)?.fplTeamName ?? String(id);

    const totals = members.flatMap((member) => {
      const last = histories.get(member.fplEntryId)?.current.at(-1);
      return last ? [{ id: member.id, points: last.total_points, transferCost: 0 }] : [];
    });

    const toRows = (input: { id: number; points: number; transferCost: number }[]) =>
      rankGameweek(input).standings.map((row) => ({ team: teamOf(row.id), value: row.net, rank: row.rank }));
    return { event: event.id, finished: event.finished, gameweek: toRows(rows), overall: toRows(totals) };
  };
}
