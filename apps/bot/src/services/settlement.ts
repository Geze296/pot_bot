import {
  applyDeadline,
  buildObligations,
  checkSettleGate,
  manualOutcome,
  parseRules,
  potFromObligations,
  rankGameweek,
  settleGameweek,
  type LeagueRules,
  type Payout,
  type SettleOutcome,
} from "@potbot/core";
import type { Gameweek, League, Member, Prisma, PrismaClient } from "@potbot/db";
import type { FplClient, FplEvent } from "@potbot/fpl";
import { t } from "../i18n/index.js";
import { scoresForEvent, SETUP_STATE } from "./league-setup.js";
import { isUniqueViolation } from "./users.js";

export interface SettlementDeps {
  db: PrismaClient;
  fpl: FplClient;
  send: (chatId: bigint, text: string) => Promise<unknown>;
}

type Tx = Prisma.TransactionClient;

/** Creates a gameweek's obligations for members who don't have one yet. Safe to run twice. */
async function ensureObligations(tx: Tx, league: League, gameweek: Gameweek): Promise<void> {
  const members = await tx.member.findMany({ where: { leagueId: league.id, status: "active" } });
  const existing = await tx.obligation.findMany({ where: { gameweekId: gameweek.id }, select: { memberId: true } });
  const missing = members.map((member) => member.id).filter((id) => !existing.some((row) => row.memberId === id));
  if (missing.length === 0) return;

  // The seeded free pass belongs to the first gameweek the bot runs.
  const isFirstRun = (await tx.obligation.count({ where: { gameweek: { leagueId: league.id } } })) === 0;
  const obligations = buildObligations({
    rules: parseRules(league.rules),
    memberIds: missing,
    freePassIds: isFirstRun ? league.seedFreePassMemberIds : [],
  });
  await tx.obligation.createMany({ data: obligations.map((item) => ({ ...item, gameweekId: gameweek.id })) });
}

async function gameweekAfter(tx: Tx, gameweek: Gameweek): Promise<Gameweek | null> {
  return tx.gameweek.findUnique({
    where: { leagueId_fplEventId: { leagueId: gameweek.leagueId, fplEventId: gameweek.fplEventId + 1 } },
  });
}

/**
 * Turns a member's fee for this gameweek into a free pass. If they already paid it, the payment moves on as a
 * credit toward the following gameweek's fee (a decision recorded in docs/PROGRESS.md).
 */
async function grantFreePass(tx: Tx, league: League, gameweek: Gameweek, memberId: number): Promise<void> {
  const obligation = await tx.obligation.findFirst({ where: { gameweekId: gameweek.id, memberId } });
  if (!obligation) return;

  if (obligation.status === "paid" && obligation.reason !== "free_pass") {
    const following = await gameweekAfter(tx, gameweek);
    if (following) {
      await ensureObligations(tx, league, following);
      const target = await tx.obligation.findFirst({ where: { gameweekId: following.id, memberId, reason: "entry" } });
      if (target) {
        await tx.payment.updateMany({ where: { obligationId: obligation.id }, data: { obligationId: target.id } });
        await tx.obligation.update({ where: { id: target.id }, data: { status: "paid" } });
      }
    }
  }
  await tx.obligation.update({
    where: { id: obligation.id },
    data: { amountDue: 0, reason: "free_pass", status: "paid" },
  });
}

async function revokePerk(tx: Tx, rules: LeagueRules, gameweek: Gameweek, memberId: number): Promise<void> {
  await tx.obligation.updateMany({
    where: { gameweekId: gameweek.id, memberId, OR: [{ reason: "free_pass" }, { status: "due" }] },
    data: { amountDue: rules.entryFee, reason: "entry", status: "due" },
  });
}

async function grantPerks(
  tx: Tx,
  league: League,
  rules: LeagueRules,
  next: Gameweek,
  perks: Pick<SettleOutcome, "freePassIds" | "halfPriceIds">,
) {
  for (const memberId of perks.freePassIds) await grantFreePass(tx, league, next, memberId);
  for (const memberId of perks.halfPriceIds) {
    await tx.obligation.updateMany({
      where: { gameweekId: next.id, memberId, status: "due" },
      data: { amountDue: Math.floor(rules.entryFee / 2) },
    });
  }
}

/** Carries leftover birr and hands out the runner-up's perk for the next gameweek. */
async function applyToNextGameweek(tx: Tx, league: League, gameweek: Gameweek, outcome: SettleOutcome): Promise<void> {
  const next = await gameweekAfter(tx, gameweek);
  if (!next) return;
  await ensureObligations(tx, league, next);
  await tx.gameweek.update({ where: { id: next.id }, data: { carryIn: { increment: outcome.carryOut } } });
  await grantPerks(tx, league, parseRules(league.rules), next, outcome);
}

function resultData(outcome: SettleOutcome) {
  return {
    winnerMemberIds: outcome.winnerIds,
    runnerUpMemberIds: outcome.runnerUpIds,
    payoutAmount: outcome.payouts.reduce((sum, payout) => sum + payout.amount, 0),
    payoutShares: outcome.payouts.map((payout) => ({ ...payout })),
    carryOut: outcome.carryOut,
    freePassMemberIds: outcome.freePassIds,
    halfPriceMemberIds: outcome.halfPriceIds,
  };
}

function resultLines(gameweek: Gameweek, pot: number, outcome: SettleOutcome, members: Member[]): string[] {
  const name = (id: number) => members.find((member) => member.id === id)?.fplManagerName ?? String(id);
  const names = (ids: number[]) => ids.map(name).join(" & ");
  const next = gameweek.fplEventId + 1;

  const lines: string[] = [];
  if (outcome.winnerIds.length > 0) {
    lines.push(t("en", "settle.winner", { names: names(outcome.winnerIds) }));
  } else {
    lines.push(t("en", "settle.noWinner"));
  }
  if (outcome.runnerUpIds.length > 0) lines.push(t("en", "settle.runnerUp", { names: names(outcome.runnerUpIds) }));
  lines.push(t("en", "settle.pot", { pot }));
  for (const payout of outcome.payouts) {
    lines.push(t("en", "settle.payoutLine", { name: name(payout.memberId), amount: payout.amount }));
  }
  if (outcome.payouts.length > 0) lines.push(t("en", "settle.payoutNote"));
  if (outcome.carryOut > 0) lines.push(t("en", "settle.carry", { amount: outcome.carryOut }));
  if (outcome.freePassIds.length > 0) {
    lines.push(t("en", "settle.freePass", { gw: next, names: names(outcome.freePassIds) }));
  }
  if (outcome.halfPriceIds.length > 0) {
    lines.push(t("en", "settle.halfPrice", { gw: next, names: names(outcome.halfPriceIds) }));
  }
  return lines;
}

/** Records that a message is going out. False means an earlier run already sent it (hard rule 7). */
async function claimMessage(db: PrismaClient, leagueId: number, dedupeKey: string, kind: string): Promise<boolean> {
  try {
    await db.messageLog.create({ data: { leagueId, dedupeKey, kind } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Saves FPL's scores for the gameweek, keeping any manual override (hard rule 8). */
async function saveScores(db: PrismaClient, fpl: FplClient, gameweek: Gameweek, members: Member[]) {
  const histories = await fpl.getEntryHistories(members.map((member) => member.fplEntryId));
  for (const row of scoresForEvent(gameweek.fplEventId, members, histories)) {
    const data = {
      points: row.points,
      transferCost: row.transferCost,
      benchPoints: row.benchPoints,
      totalPoints: row.totalPoints,
    };
    await db.score.upsert({
      where: { gameweekId_memberId: { gameweekId: gameweek.id, memberId: row.id } },
      create: { gameweekId: gameweek.id, memberId: row.id, ...data },
      update: {},
    });
    await db.score.updateMany({ where: { gameweekId: gameweek.id, memberId: row.id, source: "fpl" }, data });
  }
}

async function loadSettleInputs(db: PrismaClient | Tx, gameweek: Gameweek) {
  const [scores, obligations, latePayments] = await Promise.all([
    db.score.findMany({ where: { gameweekId: gameweek.id } }),
    db.obligation.findMany({ where: { gameweekId: gameweek.id } }),
    db.payment.findMany({
      where: { obligation: { gameweekId: gameweek.id }, paidAt: { gt: gameweek.deadlineAt } },
      include: { obligation: true },
    }),
  ]);
  return {
    rows: scores.map((score) => ({
      memberId: score.memberId,
      points: score.points,
      transferCost: score.transferCost,
      totalPoints: score.totalPoints,
    })),
    obligations,
    eligibleIds: obligations.filter((item) => item.status === "paid").map((item) => item.memberId),
    latePayerIds: latePayments.map((payment) => payment.obligation.memberId),
  };
}

const rankRows = (rows: { memberId: number; points: number; transferCost: number }[], rules: LeagueRules) =>
  rankGameweek(
    rows.map((row) => ({
      id: row.memberId,
      points: row.points,
      transferCost: rules.scoreMode === "net" ? row.transferCost : 0,
    })),
  );

async function saveRanks(
  tx: Tx,
  gameweekId: number,
  rows: { memberId: number; points: number; transferCost: number }[],
  rules: LeagueRules,
) {
  for (const standing of rankRows(rows, rules).standings) {
    await tx.score.updateMany({ where: { gameweekId, memberId: standing.id }, data: { rankInGw: standing.rank } });
  }
}

/** Settles one gameweek if FPL's data is final. Returns false to stop later gameweeks settling out of order. */
async function trySettle(deps: SettlementDeps, league: League, gameweek: Gameweek, event: FplEvent, now: Date) {
  const { db, fpl, send } = deps;
  const status = await fpl.getEventStatus();
  const gate = checkSettleGate({
    eventId: event.id,
    eventFinished: event.finished,
    eventDataChecked: event.data_checked,
    statusRows: status.status,
    leagues: status.leagues,
    finalSeenAt: gameweek.finalSeenAt,
    now,
  });
  if (gate.finalSeenAt?.getTime() !== gameweek.finalSeenAt?.getTime()) {
    await db.gameweek.update({ where: { id: gameweek.id }, data: { finalSeenAt: gate.finalSeenAt } });
  }
  if (!gate.canSettle) return false;

  // A payment sent before the deadline but not yet reviewed could change who is eligible.
  const openReviews = await db.payment.count({
    where: {
      obligation: { gameweekId: gameweek.id },
      verifyStatus: { in: ["pending", "needs_review"] },
      createdAt: { lte: gameweek.deadlineAt },
    },
  });
  if (openReviews > 0) {
    const coordinator = await db.user.findUnique({ where: { id: league.coordinatorUserId ?? league.ownerUserId } });
    const key = `settle-wait:gw${event.id}`;
    if (coordinator && (await claimMessage(db, league.id, key, "settle_wait"))) {
      await send(coordinator.telegramId, t("en", "settle.waitingForReview", { gw: event.id, count: openReviews }));
    }
    return false;
  }

  const members = await db.member.findMany({ where: { leagueId: league.id } });
  await saveScores(db, fpl, gameweek, members);

  const rules = parseRules(league.rules);
  const inputs = await loadSettleInputs(db, gameweek);
  if (inputs.rows.length === 0) return false;

  const pot = potFromObligations(inputs.obligations, gameweek.carryIn);
  const outcome = settleGameweek({
    rules,
    rows: inputs.rows,
    eligibleIds: inputs.eligibleIds,
    latePayerIds: inputs.latePayerIds,
    pot,
  });

  try {
    await db.$transaction(async (tx) => {
      // The unique gameweek_id on results stops a second settle.
      await tx.result.create({ data: { gameweekId: gameweek.id, ...resultData(outcome) } });
      await saveRanks(tx, gameweek.id, inputs.rows, rules);
      await tx.gameweek.update({ where: { id: gameweek.id }, data: { status: "settled", potAmount: pot } });
      await applyToNextGameweek(tx, league, gameweek, outcome);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return true;
    throw error;
  }

  return true;
}

/**
 * Posts results that haven't gone out, once each. If Telegram fails, the claim is released so the next tick retries,
 * rather than leaving a settled gameweek the group never heard about. Results named by hand post from the command.
 */
async function postPendingResults({ db, send }: SettlementDeps, league: League): Promise<void> {
  const settled = await db.gameweek.findMany({
    where: { leagueId: league.id, status: "settled", finalSeenAt: { not: null }, result: { source: "fpl" } },
    include: { result: true },
    orderBy: { fplEventId: "asc" },
  });
  const members = await db.member.findMany({ where: { leagueId: league.id } });

  for (const gameweek of settled) {
    const { result } = gameweek;
    const key = `settle:gw${gameweek.fplEventId}`;
    if (!result || !(await claimMessage(db, league.id, key, "settle"))) continue;

    const outcome: SettleOutcome = {
      winnerIds: result.winnerMemberIds,
      runnerUpIds: result.runnerUpMemberIds,
      lastPlaceIds: [],
      payouts: result.payoutShares as unknown as Payout[],
      carryOut: result.carryOut,
      freePassIds: result.freePassMemberIds,
      halfPriceIds: result.halfPriceMemberIds,
    };
    const lines = [
      t("en", "settle.header", { gw: gameweek.fplEventId }),
      ...resultLines(gameweek, gameweek.potAmount, outcome, members),
    ];
    try {
      await send(league.telegramChatId, lines.join("\n"));
    } catch (error) {
      await db.messageLog.delete({ where: { leagueId_dedupeKey: { leagueId: league.id, dedupeKey: key } } });
      throw error;
    }
  }
}

/** Opens payment windows and locks at deadlines. This never waits for an earlier gameweek to settle. */
async function openAndLockGameweeks(db: PrismaClient, league: League, events: FplEvent[], now: Date): Promise<void> {
  const rules = parseRules(league.rules);
  const gameweeks = await db.gameweek.findMany({
    where: { leagueId: league.id, status: "open" },
    orderBy: { fplEventId: "asc" },
  });

  for (const gameweek of gameweeks) {
    const event = events.find((item) => item.id === gameweek.fplEventId);
    if (!event) continue;

    // FPL sometimes moves a deadline, for example when fixtures are rearranged.
    const deadline = new Date(event.deadline_time);
    if (deadline.getTime() !== gameweek.deadlineAt.getTime()) {
      await db.gameweek.update({
        where: { id: gameweek.id },
        data: { deadlineAt: deadline, paymentClosesAt: deadline },
      });
    }
    if (now < gameweek.paymentOpensAt) continue;

    await db.$transaction(async (tx) => {
      await ensureObligations(tx, league, gameweek);
      if (now < deadline) return;

      const obligations = await tx.obligation.findMany({ where: { gameweekId: gameweek.id } });
      for (const obligation of obligations) {
        await tx.obligation.update({ where: { id: obligation.id }, data: applyDeadline(rules, obligation) });
      }
      await tx.gameweek.update({ where: { id: gameweek.id }, data: { status: "locked" } });
    });
  }
}

/** Moves one league forward. Every step checks current state first, so a repeated run changes nothing. */
export async function tickLeague(deps: SettlementDeps, leagueId: number, now: Date): Promise<void> {
  const { db, fpl } = deps;
  const league = await db.league.findUnique({ where: { id: leagueId } });
  if (!league || league.setupState !== SETUP_STATE.active) return;

  const { events } = await fpl.getBootstrap();
  await openAndLockGameweeks(db, league, events, now);

  // Settling goes in order, because each result decides the next gameweek's free pass.
  const locked = await db.gameweek.findMany({
    where: { leagueId, status: "locked" },
    orderBy: { fplEventId: "asc" },
  });
  for (const gameweek of locked) {
    const event = events.find((item) => item.id === gameweek.fplEventId);
    if (!event || !(await trySettle(deps, league, gameweek, event, now))) break;
  }
  await postPendingResults(deps, league);
}

export async function tickAllLeagues(deps: SettlementDeps, now: Date): Promise<void> {
  const leagues = await deps.db.league.findMany({ where: { setupState: SETUP_STATE.active }, select: { id: true } });
  for (const league of leagues) {
    try {
      await tickLeague(deps, league.id, now);
    } catch (error) {
      // FPL may be down. The next tick tries again, and one league's trouble doesn't stop the others.
      console.error(`League ${league.id} tick failed:`, error);
    }
  }
}

/** Replaces a settled result, moving leftover birr and perks to match when the next gameweek hasn't started. */
async function correctResult(
  tx: Tx,
  league: League,
  gameweek: Gameweek,
  previous: { carryOut: number; freePassMemberIds: number[]; halfPriceMemberIds: number[] },
  outcome: SettleOutcome,
): Promise<boolean> {
  const next = await gameweekAfter(tx, gameweek);
  if (!next) return false;
  await tx.gameweek.update({
    where: { id: next.id },
    data: { carryIn: { increment: outcome.carryOut - previous.carryOut } },
  });
  if (next.status !== "open") return true;

  const rules = parseRules(league.rules);
  await ensureObligations(tx, league, next);
  const old = [...previous.freePassMemberIds, ...previous.halfPriceMemberIds];
  const current = [...outcome.freePassIds, ...outcome.halfPriceIds];
  for (const memberId of old.filter((id) => !current.includes(id))) await revokePerk(tx, rules, next, memberId);
  await grantPerks(tx, league, rules, next, {
    freePassIds: outcome.freePassIds.filter((id) => !previous.freePassMemberIds.includes(id)),
    halfPriceIds: outcome.halfPriceIds.filter((id) => !previous.halfPriceMemberIds.includes(id)),
  });
  return false;
}

async function postCorrection(
  deps: Pick<SettlementDeps, "db" | "send">,
  league: League,
  gameweek: Gameweek,
  pot: number,
  outcome: SettleOutcome,
  nextLocked: boolean,
) {
  const members = await deps.db.member.findMany({ where: { leagueId: league.id } });
  const lines = [
    t("en", "override.corrected", { gw: gameweek.fplEventId }),
    ...resultLines(gameweek, pot, outcome, members),
  ];
  if (nextLocked) lines.push(t("en", "override.nextLocked", { gw: gameweek.fplEventId + 1 }));
  await deps.send(league.telegramChatId, lines.join("\n"));
}

/** Writes a manual score. If the gameweek already settled, the result is worked out again and corrected. */
export async function overrideScore(
  deps: Pick<SettlementDeps, "db" | "send">,
  input: { league: League; gameweek: Gameweek; member: Member; points: number; transferCost: number; actorId: number },
): Promise<{ corrected: boolean }> {
  const { db } = deps;
  const { league, gameweek, member, points, transferCost, actorId } = input;
  const rules = parseRules(league.rules);

  const existing = await db.score.findUnique({
    where: { gameweekId_memberId: { gameweekId: gameweek.id, memberId: member.id } },
  });
  const correction = await db.$transaction(async (tx) => {
    await tx.score.upsert({
      where: { gameweekId_memberId: { gameweekId: gameweek.id, memberId: member.id } },
      create: { gameweekId: gameweek.id, memberId: member.id, points, transferCost, benchPoints: 0, source: "manual" },
      update: { points, transferCost, source: "manual" },
    });
    await tx.auditLog.create({
      data: {
        leagueId: league.id,
        actorId,
        action: "score.override",
        entity: "score",
        entityId: member.id,
        before: existing ? { points: existing.points, transferCost: existing.transferCost } : {},
        after: { gameweek: gameweek.fplEventId, points, transferCost },
      },
    });

    const result = await tx.result.findUnique({ where: { gameweekId: gameweek.id } });
    if (gameweek.status !== "settled" || !result) return undefined;

    const inputs = await loadSettleInputs(tx, gameweek);
    await saveRanks(tx, gameweek.id, inputs.rows, rules);
    // A winner named by hand stays, whatever the scores now say (hard rule 8).
    if (result.source === "manual") return undefined;

    const outcome = settleGameweek({
      rules,
      rows: inputs.rows,
      eligibleIds: inputs.eligibleIds,
      latePayerIds: inputs.latePayerIds,
      pot: gameweek.potAmount,
    });
    await tx.result.update({ where: { id: result.id }, data: resultData(outcome) });
    const nextLocked = await correctResult(tx, league, gameweek, result, outcome);
    return { outcome, nextLocked };
  });

  if (!correction) return { corrected: false };
  await postCorrection(deps, league, gameweek, gameweek.potAmount, correction.outcome, correction.nextLocked);
  return { corrected: true };
}

/** Names the winner by hand. Also settles a gameweek FPL can't, for example during an outage. */
export async function overrideWinner(
  deps: Pick<SettlementDeps, "db" | "send">,
  input: { league: League; gameweek: Gameweek; winnerIds: number[]; runnerUpIds: number[]; actorId: number },
): Promise<void> {
  const { db } = deps;
  const { league, gameweek, winnerIds, runnerUpIds, actorId } = input;
  const rules = parseRules(league.rules);

  const { outcome, pot, nextLocked } = await db.$transaction(async (tx) => {
    const obligations = await tx.obligation.findMany({ where: { gameweekId: gameweek.id } });
    const pot = gameweek.status === "settled" ? gameweek.potAmount : potFromObligations(obligations, gameweek.carryIn);
    const outcome = manualOutcome({ rules, winnerIds, runnerUpIds, pot });
    const data = { ...resultData(outcome), source: "manual" as const };

    const previous = await tx.result.findUnique({ where: { gameweekId: gameweek.id } });
    await tx.result.upsert({
      where: { gameweekId: gameweek.id },
      create: { gameweekId: gameweek.id, ...data },
      update: data,
    });
    await tx.auditLog.create({
      data: {
        leagueId: league.id,
        actorId,
        action: "result.override",
        entity: "gameweek",
        entityId: gameweek.id,
        before: previous
          ? { winnerMemberIds: previous.winnerMemberIds, runnerUpMemberIds: previous.runnerUpMemberIds }
          : {},
        after: { winnerMemberIds: winnerIds, runnerUpMemberIds: runnerUpIds },
      },
    });

    let nextLocked = false;
    if (previous) {
      nextLocked = await correctResult(tx, league, gameweek, previous, outcome);
    } else {
      await tx.gameweek.update({ where: { id: gameweek.id }, data: { status: "settled", potAmount: pot } });
      await applyToNextGameweek(tx, league, gameweek, outcome);
    }
    return { outcome, pot, nextLocked };
  });

  await postCorrection(deps, league, gameweek, pot, outcome, nextLocked);
}
