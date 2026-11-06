import type { League, Member, PrismaClient } from "@potbot/db";
import { InlineKeyboard } from "grammy";
import { t } from "../i18n/index.js";
import { claimMessage, releaseMessage } from "./message-log.js";
import type { SettlementDeps } from "./settlement.js";
import { isUniqueViolation } from "./users.js";

export interface Share {
  memberId: number;
  amount: number;
}

/** What each winner is owed and hasn't been recorded as receiving. */
export async function unpaidShares(db: PrismaClient, gameweekId: number): Promise<(Share & { member: Member })[]> {
  const result = await db.result.findUnique({ where: { gameweekId }, include: { payouts: true } });
  if (!result) return [];

  const shares = (result.payoutShares as unknown as Share[]).filter(
    (share) => share.amount > 0 && !result.payouts.some((payout) => payout.memberId === share.memberId),
  );
  const members = await db.member.findMany({ where: { id: { in: shares.map((share) => share.memberId) } } });
  return shares.map((share) => ({ ...share, member: members.find((member) => member.id === share.memberId)! }));
}

export function payoutCard(fplEventId: number, gameweekId: number, shares: (Share & { member: Member })[]) {
  const lines = shares.map(({ member, amount }) =>
    t("en", "payout.line", {
      name: member.fplManagerName,
      team: member.fplTeamName,
      entry: member.fplEntryId,
      amount,
    }),
  );
  const keyboard = new InlineKeyboard();
  for (const { member } of shares) {
    keyboard.text(t("en", "payout.button", { name: member.fplManagerName }), `payout:${gameweekId}:${member.id}`).row();
  }
  return {
    text: t("en", "payout.card", { gw: fplEventId, lines: lines.join("\n") }),
    reply_markup: keyboard,
  };
}

/**
 * Tells the coordinator who to pay. It goes privately because it's a to-do list, not news. If they never pressed
 * Start, the group gets it instead, since only they and the owner can tap it. The key includes who is owed, so a
 * correction that changes the winners sends a fresh card.
 */
export async function sendPayoutCard(
  { db, send }: Pick<SettlementDeps, "db" | "send">,
  league: League,
  gameweekId: number,
): Promise<void> {
  const gameweek = await db.gameweek.findUniqueOrThrow({ where: { id: gameweekId } });
  const shares = await unpaidShares(db, gameweekId);
  if (shares.length === 0) return;

  const owed = shares.map((share) => `${share.memberId}=${share.amount}`).join(",");
  const key = `payout-card:gw${gameweek.fplEventId}:${owed}`;
  if (!(await claimMessage(db, league.id, key, "payout_card"))) return;

  const { text, reply_markup } = payoutCard(gameweek.fplEventId, gameweek.id, shares);
  const coordinator = await db.user.findUniqueOrThrow({
    where: { id: league.coordinatorUserId ?? league.ownerUserId },
  });
  try {
    await send(coordinator.telegramId, text, { reply_markup });
  } catch {
    try {
      await send(league.telegramChatId, text, { reply_markup });
    } catch (error) {
      await releaseMessage(db, league.id, key);
      throw error;
    }
  }
}

export type PayoutResult =
  { kind: "done"; amount: number; member: Member } | { kind: "already" | "not_settled" | "not_winner" | "txn_used" };

/** Records that a winner got their share, once. The amount always comes from the result, never from what's typed. */
export async function recordPayout(
  db: PrismaClient,
  input: { gameweekId: number; memberId: number; txnId?: string; actorId: number; leagueId: number; now: Date },
): Promise<PayoutResult> {
  const { gameweekId, memberId, txnId, actorId, leagueId, now } = input;
  const result = await db.result.findUnique({ where: { gameweekId } });
  if (!result) return { kind: "not_settled" };

  const share = (result.payoutShares as unknown as Share[]).find((item) => item.memberId === memberId);
  if (!share || share.amount <= 0) return { kind: "not_winner" };

  // Hard rule 6 is about proof being reused, so a payment's number can't double as a payout's.
  if (txnId && (await db.payment.findUnique({ where: { txnId } }))) return { kind: "txn_used" };

  try {
    return await db.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          resultId: result.id,
          memberId,
          amount: share.amount,
          txnId: txnId ?? null,
          paidAt: now,
          recordedBy: actorId,
        },
        include: { member: true },
      });
      await tx.auditLog.create({
        data: {
          leagueId,
          actorId,
          action: "payout.record",
          entity: "payout",
          entityId: payout.id,
          after: { gameweekId, memberId, amount: share.amount, txnId: txnId ?? null },
        },
      });

      const paid = await tx.payout.count({ where: { resultId: result.id } });
      const owed = (result.payoutShares as unknown as Share[]).filter((item) => item.amount > 0).length;
      if (paid >= owed) await tx.result.update({ where: { id: result.id }, data: { paidOutAt: now } });

      return { kind: "done" as const, amount: share.amount, member: payout.member };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.payout.findUnique({ where: { resultId_memberId: { resultId: result.id, memberId } } });
    return { kind: existing ? "already" : "txn_used" };
  }
}
