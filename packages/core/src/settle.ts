import type { LeagueRules } from "./rules.js";

export interface SettleRow {
  memberId: number;
  points: number;
  transferCost: number;
  /** FPL's overall total, for the tie-break. */
  totalPoints: number;
}

export interface SettleInput {
  rules: LeagueRules;
  rows: SettleRow[];
  /** Members who paid or hold a free pass. Ignored when anyone can win. */
  eligibleIds: number[];
  /** Whole birr: paid fees plus anything carried in. */
  pot: number;
  /** Members who paid after the deadline. They can't earn a free pass under "lose_free_pass". */
  latePayerIds?: number[];
}

export interface Payout {
  memberId: number;
  amount: number;
}

export interface SettleOutcome {
  winnerIds: number[];
  runnerUpIds: number[];
  lastPlaceIds: number[];
  payouts: Payout[];
  /** Leftover birr, rolled into the next pot. */
  carryOut: number;
  freePassIds: number[];
  halfPriceIds: number[];
}

const scoreOf = (rules: LeagueRules, row: SettleRow): number =>
  rules.scoreMode === "net" ? row.points - row.transferCost : row.points;

/** Rows sharing a value stay together, in the order given. */
function groupBy(rows: SettleRow[], valueOf: (row: SettleRow) => string | number): SettleRow[][] {
  const groups: SettleRow[][] = [];
  for (const row of rows) {
    const group = groups.at(-1);
    if (group && valueOf(group[0]!) === valueOf(row)) group.push(row);
    else groups.push([row]);
  }
  return groups;
}

/** Fewer hits, then the higher overall total. Anyone still level stays tied. */
function tieBreak(group: SettleRow[]): SettleRow[][] {
  const sorted = [...group].sort((a, b) => a.transferCost - b.transferCost || b.totalPoints - a.totalPoints);
  return groupBy(sorted, (row) => `${row.transferCost}:${row.totalPoints}`);
}

/** Finishing places, best first. Each place holds everyone tied there. */
function finishingPlaces(rules: LeagueRules, rows: SettleRow[]): SettleRow[][] {
  const sorted = [...rows].sort((a, b) => scoreOf(rules, b) - scoreOf(rules, a));
  const places = groupBy(sorted, (row) => scoreOf(rules, row));

  if (rules.tieFirst === "tie_break" && places[0]) places.splice(0, 1, ...tieBreak(places[0]));
  if (rules.tieSecond === "tie_break" && places[1]) places.splice(1, 1, ...tieBreak(places[1]));
  return places;
}

/** Tied places pool the shares of the positions they fill. Rounding down leaves the rest to carry over. */
function payoutsFor(places: number[][], shares: number[], pot: number): { payouts: Payout[]; carryOut: number } {
  const payouts: Payout[] = [];
  let position = 0;
  for (const place of places) {
    const percent = shares.slice(position, position + place.length).reduce((sum, share) => sum + share, 0);
    position += place.length;
    if (percent === 0) continue;

    const amount = Math.floor(Math.floor((pot * percent) / 100) / place.length);
    for (const memberId of place) payouts.push({ memberId, amount });
  }
  const paid = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  return { payouts, carryOut: pot - paid };
}

function perksFor(rules: LeagueRules, runnerUpIds: number[], latePayerIds: number[] = []) {
  const earning =
    rules.lateRule === "lose_free_pass" ? runnerUpIds.filter((id) => !latePayerIds.includes(id)) : runnerUpIds;
  return {
    freePassIds: rules.runnerUpPerk === "skip_next" ? earning : [],
    halfPriceIds: rules.runnerUpPerk === "half_price" ? earning : [],
  };
}

export function settleGameweek(input: SettleInput): SettleOutcome {
  const { rules, rows, eligibleIds, pot } = input;
  const candidates = rules.whoCanWin === "everyone" ? rows : rows.filter((row) => eligibleIds.includes(row.memberId));
  const places = finishingPlaces(rules, candidates).map((place) => place.map((row) => row.memberId));

  const winnerIds = places[0] ?? [];
  const runnerUpIds = places[1] ?? [];
  const everyone = [...rows].sort((a, b) => scoreOf(rules, a) - scoreOf(rules, b));
  const lastScore = everyone[0] ? scoreOf(rules, everyone[0]) : undefined;

  return {
    winnerIds,
    runnerUpIds,
    lastPlaceIds: everyone.filter((row) => scoreOf(rules, row) === lastScore).map((row) => row.memberId),
    ...payoutsFor(places, rules.prizeShares, pot),
    ...perksFor(rules, runnerUpIds, input.latePayerIds),
  };
}

/** An owner or coordinator named the result by hand (hard rule 8). The named winners split the whole pot. */
export function manualOutcome(input: {
  rules: LeagueRules;
  winnerIds: number[];
  runnerUpIds: number[];
  pot: number;
}): SettleOutcome {
  const { rules, winnerIds, runnerUpIds, pot } = input;
  return {
    winnerIds,
    runnerUpIds,
    lastPlaceIds: [],
    ...payoutsFor([winnerIds], [100], pot),
    ...perksFor(rules, runnerUpIds),
  };
}
