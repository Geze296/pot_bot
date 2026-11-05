import type { PrismaClient } from "@potbot/db";
import { isUniqueViolation } from "./users.js";

/** Records that a message is going out. False means an earlier run already sent it (hard rule 7). */
export async function claimMessage(
  db: PrismaClient,
  leagueId: number,
  dedupeKey: string,
  kind: string,
): Promise<boolean> {
  try {
    await db.messageLog.create({ data: { leagueId, dedupeKey, kind } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Gives a claim back after a failed send, so the next tick tries again. */
export async function releaseMessage(db: PrismaClient, leagueId: number, dedupeKey: string): Promise<void> {
  await db.messageLog.delete({ where: { leagueId_dedupeKey: { leagueId, dedupeKey } } });
}
