import type { AuditLog, PrismaClient } from "@potbot/db";

/**
 * Turns stored IDs into names, so the audit screen says who and what instead of "memberId: 1". Names are looked up
 * when read. The log itself keeps the IDs, because people rename themselves.
 */
export async function auditNames(db: PrismaClient, leagueId: number, entries: AuditLog[]) {
  const idsOf = (entity: string) => entries.filter((entry) => entry.entity === entity).map((entry) => entry.entityId);
  const [members, users, gameweeks, payments, obligations, payouts, facts] = await Promise.all([
    db.member.findMany({ where: { leagueId } }),
    db.user.findMany({
      where: {
        OR: [
          { id: { in: entries.map((entry) => entry.actorId) } },
          { members: { some: { leagueId } } },
          { coordinatedLeagues: { some: { id: leagueId } } },
          { ownedLeagues: { some: { id: leagueId } } },
        ],
      },
    }),
    db.gameweek.findMany({ where: { leagueId } }),
    db.payment.findMany({
      where: { id: { in: idsOf("payment") } },
      include: { obligation: true },
    }),
    db.obligation.findMany({ where: { id: { in: idsOf("obligation") } } }),
    db.payout.findMany({ where: { id: { in: idsOf("payout") } }, include: { result: true } }),
    db.memberFact.findMany({ where: { id: { in: idsOf("member_fact") } } }),
  ]);

  const managerName = (id: unknown) => members.find((member) => member.id === id)?.fplManagerName ?? "";
  const userName = (id: unknown) => users.find((user) => user.id === id)?.displayName ?? "";
  const gameweekName = (id: unknown) => {
    const event = gameweeks.find((gameweek) => gameweek.id === id)?.fplEventId;
    return event === undefined ? "" : `GW${event}`;
  };
  const both = (memberId: number, gameweekId: number) => `${managerName(memberId)}, ${gameweekName(gameweekId)}`;

  function subject(entry: AuditLog): string {
    const id = entry.entityId;
    switch (entry.entity) {
      case "member":
      case "score":
        return managerName(id);
      case "gameweek":
        return gameweekName(id);
      case "payment": {
        const payment = payments.find((item) => item.id === id);
        return payment ? both(payment.obligation.memberId, payment.obligation.gameweekId) : "";
      }
      case "obligation": {
        const obligation = obligations.find((item) => item.id === id);
        return obligation ? both(obligation.memberId, obligation.gameweekId) : "";
      }
      case "payout": {
        const payout = payouts.find((item) => item.id === id);
        return payout ? both(payout.memberId, payout.result.gameweekId) : "";
      }
      case "member_fact": {
        const fact = facts.find((item) => item.id === id);
        return fact ? managerName(fact.memberId) : "";
      }
      default:
        return "";
    }
  }

  /** Replaces ID fields with what they point to, under the same meaning. */
  function values(stored: unknown): Record<string, unknown> {
    if (stored === null || typeof stored !== "object") return {};
    const named = (ids: unknown) => (Array.isArray(ids) ? ids.map(managerName).join(" & ") : "");
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (key === "memberId") result.member = managerName(value);
      else if (key === "userId") result.user = userName(value);
      else if (key === "coordinatorUserId") result.coordinator = userName(value);
      else if (key === "gameweekId") result.gameweek = gameweekName(value);
      else if (key === "winnerMemberIds") result.winners = named(value);
      else if (key === "runnerUpMemberIds") result.runnersUp = named(value);
      else if (Array.isArray(value)) result[key] = value.join(",");
      else result[key] = value;
    }
    return result;
  }

  return { userName, subject, values };
}
