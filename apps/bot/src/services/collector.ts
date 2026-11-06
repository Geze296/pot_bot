import type { Gameweek, League, Member, Prisma, PrismaClient } from "@potbot/db";
import type { Share } from "./payouts.js";

type Db = Prisma.TransactionClient | PrismaClient;

/** Marks a fee as the collector's own, so it's never mistaken for money someone actually sent. */
export const COLLECTOR_FEE = "collector";

/**
 * Everyone sends their fee to the coordinator, so if they play too, they're the collector. They can't send money to
 * themselves, so they're never asked for a fee and never sent a payout.
 */
export async function collectorOf(db: Db, league: League): Promise<Member | null> {
  if (league.coordinatorUserId === null) return null;
  return db.member.findFirst({
    where: { leagueId: league.id, userId: league.coordinatorUserId, status: "active" },
  });
}

/**
 * Counts the collector's fee as paid, and it stays in the pot. It also hands it back if the coordinator has changed.
 * Only for open gameweeks: once a deadline has passed, who was playing is settled. Safe to run twice.
 */
export async function applyCollectorFee(tx: Prisma.TransactionClient, league: League, gameweek: Gameweek) {
  if (gameweek.status !== "open") return;
  const collector = await collectorOf(tx, league);

  const stale = await tx.payment.findMany({
    where: {
      verifyReason: COLLECTOR_FEE,
      obligation: { gameweekId: gameweek.id, ...(collector ? { memberId: { not: collector.id } } : {}) },
    },
  });
  for (const payment of stale) {
    await tx.payment.delete({ where: { id: payment.id } });
    await tx.obligation.update({ where: { id: payment.obligationId }, data: { status: "due" } });
  }
  if (!collector) return;

  const fee = await tx.obligation.findFirst({
    where: { gameweekId: gameweek.id, memberId: collector.id, status: "due" },
  });
  if (!fee) return;

  await tx.payment.create({
    data: {
      obligationId: fee.id,
      amount: fee.amountDue,
      method: "manual",
      verifyStatus: "verified",
      verifyReason: COLLECTOR_FEE,
    },
  });
  await tx.obligation.update({ where: { id: fee.id }, data: { status: "paid" } });
}

/**
 * The collector already holds the pot, so their share counts as delivered with nothing to send or announce. A
 * correction can change their share or remove it, so this follows the result. Safe to run twice.
 */
export async function syncCollectorPayout(tx: Prisma.TransactionClient, league: League, resultId: number, now: Date) {
  const result = await tx.result.findUniqueOrThrow({ where: { id: resultId } });
  const shares = (result.payoutShares ?? []) as unknown as Share[];
  const collector = await collectorOf(tx, league);

  if (collector) {
    const share = shares.find((item) => item.memberId === collector.id && item.amount > 0);
    const where = { resultId_memberId: { resultId, memberId: collector.id } };
    if (share) {
      await tx.payout.upsert({
        where,
        create: {
          resultId,
          memberId: collector.id,
          amount: share.amount,
          paidAt: now,
          recordedBy: league.coordinatorUserId!,
        },
        update: { amount: share.amount },
      });
    } else {
      await tx.payout.deleteMany({ where: { resultId, memberId: collector.id } });
    }
  }

  const owed = shares.filter((share) => share.amount > 0);
  const paid = await tx.payout.findMany({ where: { resultId } });
  const allPaid = owed.length > 0 && owed.every((share) => paid.some((item) => item.memberId === share.memberId));
  await tx.result.update({ where: { id: resultId }, data: { paidOutAt: allPaid ? (result.paidOutAt ?? now) : null } });
}
