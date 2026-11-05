import { potFromObligations, parseRules } from "@potbot/core";
import type { Gameweek, League, Member, Obligation, Prisma, PrismaClient } from "@potbot/db";
import { amountCovers, type ReviewReason, type ScreenshotDecision } from "@potbot/payments";
import { ensureObligations } from "./settlement.js";
import { isUniqueViolation } from "./users.js";

type Tx = Prisma.TransactionClient;

export type AnyReviewReason = ReviewReason | "out_of_window";

export type SubmitResult =
  | { kind: "paid"; gameweek: number; pot: number; lateFor?: number }
  | { kind: "duplicate" }
  | { kind: "short"; amount: number; due: number }
  | { kind: "review"; paymentId: number; gameweek: number; reason: AnyReviewReason }
  | { kind: "no_gameweek" };

export function currentGameweek(db: PrismaClient | Tx, leagueId: number): Promise<Gameweek | null> {
  return db.gameweek.findFirst({ where: { leagueId, status: "open" }, orderBy: { fplEventId: "asc" } });
}

/** The obligation for the first open gameweek, creating it if the 15-minute job hasn't yet. */
export async function currentObligation(db: PrismaClient, league: League, member: Member) {
  const gameweek = await currentGameweek(db, league.id);
  if (!gameweek) return null;
  await db.$transaction((tx) => ensureObligations(tx, league, gameweek));
  const obligation = await db.obligation.findFirst({ where: { gameweekId: gameweek.id, memberId: member.id } });
  return obligation ? { gameweek, obligation } : null;
}

interface PaymentTarget {
  gameweek: Gameweek;
  obligation: Obligation;
  /** The gameweek whose window the payment's date falls in. */
  windowGameweek: Gameweek;
}

/**
 * Payment windows run from one deadline to the next, so a date always points at one gameweek. A payment dated after
 * a deadline therefore lands on the next gameweek. If that fee is already covered (paid, or a free pass), it moves
 * on as credit. A payment dated before the deadline still counts for that gameweek if it arrives before settling.
 */
async function findTarget(tx: Tx, league: League, member: Member, paidAt: Date): Promise<PaymentTarget | null> {
  const gameweeks = await tx.gameweek.findMany({ where: { leagueId: league.id }, orderBy: { fplEventId: "asc" } });
  const start = gameweeks.findIndex((item) => paidAt >= item.paymentOpensAt && paidAt < item.paymentClosesAt);
  const windowGameweek = gameweeks[start];
  if (!windowGameweek) return null;

  for (const gameweek of gameweeks.slice(start)) {
    const canTake = gameweek.status === "open" || (gameweek.status === "locked" && gameweek.id === windowGameweek.id);
    if (!canTake) continue;

    if (gameweek.status === "open") await ensureObligations(tx, league, gameweek);
    const obligation = await tx.obligation.findFirst({ where: { gameweekId: gameweek.id, memberId: member.id } });
    if (obligation && obligation.status !== "paid") return { gameweek, obligation, windowGameweek };
  }
  return null;
}

async function potOf(tx: Tx | PrismaClient, gameweek: Gameweek): Promise<number> {
  const obligations = await tx.obligation.findMany({ where: { gameweekId: gameweek.id } });
  return potFromObligations(obligations, gameweek.carryIn);
}

async function wasWaived(tx: Tx, league: League, member: Member, target: PaymentTarget): Promise<number | undefined> {
  const event = target.gameweek.fplEventId - 1;
  const previous = await tx.obligation.findFirst({
    where: { memberId: member.id, status: "waived", gameweek: { leagueId: league.id, fplEventId: event } },
  });
  return previous ? event : undefined;
}

async function createReview(
  tx: Tx,
  league: League,
  member: Member,
  decision: { txnId?: string; amount?: number; paidAt?: Date },
  reason: AnyReviewReason,
  now: Date,
): Promise<SubmitResult> {
  const target = decision.paidAt ? await findTarget(tx, league, member, decision.paidAt) : null;
  let gameweek = target?.gameweek ?? (await currentGameweek(tx, league.id));
  if (!gameweek) return { kind: "no_gameweek" };
  let obligation = target?.obligation;

  if (!obligation) {
    await ensureObligations(tx, league, gameweek);
    obligation =
      (await tx.obligation.findFirst({ where: { gameweekId: gameweek.id, memberId: member.id } })) ?? undefined;
  }
  if (!obligation) return { kind: "no_gameweek" };
  gameweek = target?.gameweek ?? gameweek;

  const payment = await tx.payment.create({
    data: {
      obligationId: obligation.id,
      txnId: decision.txnId ?? null,
      amount: obligation.amountDue,
      paidAt: decision.paidAt ?? null,
      method: "screenshot",
      verifyStatus: "needs_review",
      verifyReason: reason,
      createdAt: now,
    },
  });
  return { kind: "review", paymentId: payment.id, gameweek: gameweek.fplEventId, reason };
}

/** Turns a screenshot decision into a payment. A reused transaction number always fails here (hard rule 6). */
export async function recordDecision(
  db: PrismaClient,
  input: {
    league: League;
    member: Member;
    decision: Extract<ScreenshotDecision, { kind: "accepted" | "review" }>;
    now: Date;
  },
): Promise<SubmitResult> {
  const { league, member, decision, now } = input;
  try {
    return await db.$transaction(async (tx) => {
      if (decision.kind === "review") {
        return createReview(tx, league, member, decision, decision.reason, now);
      }

      const target = await findTarget(tx, league, member, decision.paidAt);
      if (!target) return createReview(tx, league, member, decision, "out_of_window", now);
      if (!amountCovers(decision.amount, target.obligation.amountDue)) {
        return { kind: "short", amount: decision.amount, due: target.obligation.amountDue };
      }

      await tx.payment.create({
        data: {
          obligationId: target.obligation.id,
          txnId: decision.txnId,
          // The fee, not the screenshot's amount, which includes Telebirr's own charge.
          amount: target.obligation.amountDue,
          paidAt: decision.paidAt,
          receiverMatch: true,
          method: "screenshot",
          verifyStatus: "verified",
          createdAt: now,
        },
      });
      await tx.obligation.update({ where: { id: target.obligation.id }, data: { status: "paid" } });

      const lateFor = await wasWaived(tx, league, member, target);
      return {
        kind: "paid",
        gameweek: target.gameweek.fplEventId,
        pot: await potOf(tx, target.gameweek),
        ...(lateFor !== undefined ? { lateFor } : {}),
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: "duplicate" };
    throw error;
  }
}

export interface ReviewOutcome {
  league: League;
  member: Member;
  gameweek: number;
  pot: number;
}

/** Approves or rejects a payment under review, once. Null means someone already decided it. */
export async function decideReview(
  db: PrismaClient,
  input: { paymentId: number; actorId: number; approve: boolean },
): Promise<ReviewOutcome | null> {
  const { paymentId, actorId, approve } = input;
  return db.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, verifyStatus: "needs_review" },
      data: { verifyStatus: approve ? "verified" : "rejected", reviewedBy: actorId },
    });
    if (count === 0) return null;

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { obligation: { include: { gameweek: { include: { league: true } }, member: true } } },
    });
    const { obligation } = payment;
    const { league } = obligation.gameweek;
    let gameweek: Gameweek = obligation.gameweek;

    if (approve) {
      let target: Obligation | null = obligation;
      if (obligation.status === "paid" || gameweek.status === "settled") {
        // That fee is covered or that gameweek is over, so this becomes credit toward the next open fee.
        target = null;
        const open = await tx.gameweek.findMany({
          where: { leagueId: league.id, status: "open" },
          orderBy: { fplEventId: "asc" },
        });
        for (const candidate of open) {
          await ensureObligations(tx, league, candidate);
          target = await tx.obligation.findFirst({
            where: { gameweekId: candidate.id, memberId: obligation.memberId, status: "due" },
          });
          if (target) {
            gameweek = candidate;
            break;
          }
        }
      }
      if (target) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { obligationId: target.id, amount: target.amountDue },
        });
        await tx.obligation.update({ where: { id: target.id }, data: { status: "paid" } });
      }
    }

    await tx.auditLog.create({
      data: {
        leagueId: league.id,
        actorId,
        action: approve ? "payment.approve" : "payment.reject",
        entity: "payment",
        entityId: payment.id,
        before: { verifyStatus: "needs_review" },
        after: { verifyStatus: approve ? "verified" : "rejected" },
      },
    });
    return { league, member: obligation.member, gameweek: gameweek.fplEventId, pot: await potOf(tx, gameweek) };
  });
}

export type ManualResult = "done" | "already" | "settled" | "not_paid";

/** Cash or another payment the coordinator vouches for (SPEC, payment flow step 7). */
export async function markPaid(
  db: PrismaClient,
  input: { league: League; member: Member; gameweek: Gameweek; actorId: number; now: Date },
): Promise<ManualResult> {
  const { league, member, gameweek, actorId, now } = input;
  if (gameweek.status === "settled") return "settled";
  return db.$transaction(async (tx) => {
    await ensureObligations(tx, league, gameweek);
    const obligation = await tx.obligation.findFirst({ where: { gameweekId: gameweek.id, memberId: member.id } });
    if (!obligation || obligation.status === "paid") return "already";

    await tx.payment.create({
      data: {
        obligationId: obligation.id,
        amount: obligation.amountDue,
        paidAt: now,
        method: "manual",
        verifyStatus: "verified",
        reviewedBy: actorId,
        createdAt: now,
      },
    });
    await tx.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });
    await tx.auditLog.create({
      data: {
        leagueId: league.id,
        actorId,
        action: "payment.mark_paid",
        entity: "obligation",
        entityId: obligation.id,
        before: { status: obligation.status },
        after: { status: "paid" },
      },
    });
    return "done";
  });
}

/** Undoes a payment, for example a screenshot that turned out to be fake. Its transaction number stays used. */
export async function markUnpaid(
  db: PrismaClient,
  input: { league: League; member: Member; gameweek: Gameweek; actorId: number },
): Promise<ManualResult> {
  const { league, member, gameweek, actorId } = input;
  if (gameweek.status === "settled") return "settled";
  return db.$transaction(async (tx) => {
    const obligation = await tx.obligation.findFirst({ where: { gameweekId: gameweek.id, memberId: member.id } });
    if (!obligation || obligation.status !== "paid" || obligation.reason === "free_pass") return "not_paid";

    const status = gameweek.status === "open" ? ("due" as const) : ("waived" as const);
    const rules = parseRules(league.rules);
    const amountDue = obligation.reason === "late_fee" ? rules.lateFee : obligation.amountDue;
    await tx.payment.updateMany({
      where: { obligationId: obligation.id, verifyStatus: "verified" },
      data: { verifyStatus: "rejected", reviewedBy: actorId },
    });
    await tx.obligation.update({ where: { id: obligation.id }, data: { status, amountDue } });
    await tx.auditLog.create({
      data: {
        leagueId: league.id,
        actorId,
        action: "payment.mark_unpaid",
        entity: "obligation",
        entityId: obligation.id,
        before: { status: "paid" },
        after: { status },
      },
    });
    return "done";
  });
}
