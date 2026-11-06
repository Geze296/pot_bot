import { memberLedger } from "@potbot/core";
import type { PrismaClient } from "@potbot/db";
import { t } from "../i18n/index.js";
import type { Share } from "./payouts.js";

export interface LedgerMemberRow {
  memberId: number;
  manager: string;
  team: string;
  paidIn: number;
  won: number;
  /** What the coordinator has recorded sending them. */
  received: number;
  net: number;
}

export interface LedgerWeekRow {
  gameweek: number;
  memberId: number;
  manager: string;
  team: string;
  reason: string;
  status: string;
  paid: number;
  won: number;
  received: number;
}

export interface Ledger {
  members: LedgerMemberRow[];
  weeks: LedgerWeekRow[];
}

/** Every birr in and out, per member and per gameweek. It's worked out from the records, so it can't drift. */
export async function leagueLedger(db: PrismaClient, leagueId: number): Promise<Ledger> {
  const [members, gameweeks] = await Promise.all([
    db.member.findMany({ where: { leagueId }, orderBy: { id: "asc" } }),
    db.gameweek.findMany({
      where: { leagueId, OR: [{ obligations: { some: {} } }, { result: { isNot: null } }] },
      include: {
        obligations: { include: { payments: { where: { verifyStatus: "verified" } } } },
        result: { include: { payouts: true } },
      },
      orderBy: { fplEventId: "asc" },
    }),
  ]);
  const memberOf = (id: number) => members.find((member) => member.id === id);

  const payments = gameweeks.flatMap((gameweek) =>
    gameweek.obligations.flatMap((obligation) =>
      obligation.payments.map((payment) => ({ memberId: obligation.memberId, amount: payment.amount })),
    ),
  );
  const shares = gameweeks.flatMap((gameweek) => (gameweek.result?.payoutShares ?? []) as unknown as Share[]);
  const payouts = gameweeks.flatMap((gameweek) => gameweek.result?.payouts ?? []);
  const totals = memberLedger({ payments, payouts: shares });

  const memberRows = members
    .map((member) => {
      const total = totals.find((row) => row.memberId === member.id);
      return {
        memberId: member.id,
        manager: member.fplManagerName,
        team: member.fplTeamName,
        paidIn: total?.paidIn ?? 0,
        won: total?.won ?? 0,
        received: payouts.filter((payout) => payout.memberId === member.id).reduce((sum, item) => sum + item.amount, 0),
        net: total?.net ?? 0,
      };
    })
    .sort((a, b) => b.net - a.net);

  const weeks = gameweeks.flatMap((gameweek) => {
    const weekShares = (gameweek.result?.payoutShares ?? []) as unknown as Share[];
    const weekPayouts = gameweek.result?.payouts ?? [];
    const ids = new Set([...gameweek.obligations.map((item) => item.memberId), ...weekShares.map((s) => s.memberId)]);
    return [...ids].map((memberId) => {
      const obligation = gameweek.obligations.find((item) => item.memberId === memberId);
      const member = memberOf(memberId);
      return {
        gameweek: gameweek.fplEventId,
        memberId,
        manager: member?.fplManagerName ?? "",
        team: member?.fplTeamName ?? "",
        reason: obligation?.reason ?? "",
        status: obligation?.status ?? "",
        paid: obligation?.payments.reduce((sum, payment) => sum + payment.amount, 0) ?? 0,
        won: weekShares.find((share) => share.memberId === memberId)?.amount ?? 0,
        received: weekPayouts.find((payout) => payout.memberId === memberId)?.amount ?? 0,
      };
    });
  });

  return { members: memberRows, weeks };
}

/** Quotes what needs it. A leading =, +, - or @ is defused, so a team name can't run as a spreadsheet formula. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Every gameweek's lines, then a total line per member. */
export function ledgerCsv(ledger: Ledger): string {
  const total = t("en", "ledger.csvTotal");
  const lines = [
    t("en", "ledger.csvHeader"),
    ...ledger.weeks.map((row) =>
      [row.gameweek, row.manager, row.team, row.reason, row.status, row.paid, row.won, row.received, ""]
        .map(csvCell)
        .join(","),
    ),
    ...ledger.members.map((row) =>
      [total, row.manager, row.team, "", "", row.paidIn, row.won, row.received, row.net].map(csvCell).join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
