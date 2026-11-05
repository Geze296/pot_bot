import type { LeagueRules } from "./rules.js";

export type ObligationReason = "entry" | "free_pass" | "late_fee";
export type ObligationStatus = "due" | "paid" | "waived";

export interface ObligationTerms {
  amountDue: number;
  reason: ObligationReason;
  status: ObligationStatus;
}

export function buildObligations(input: {
  rules: LeagueRules;
  memberIds: number[];
  freePassIds?: number[];
  halfPriceIds?: number[];
}): (ObligationTerms & { memberId: number })[] {
  const { rules, memberIds, freePassIds = [], halfPriceIds = [] } = input;
  return memberIds.map((memberId) => {
    if (freePassIds.includes(memberId)) return { memberId, amountDue: 0, reason: "free_pass", status: "paid" };
    const amountDue = halfPriceIds.includes(memberId) ? Math.floor(rules.entryFee / 2) : rules.entryFee;
    return { memberId, amountDue, reason: "entry", status: "due" };
  });
}

/** What happens to an obligation when the payment window closes. */
export function applyDeadline(rules: LeagueRules, obligation: ObligationTerms): ObligationTerms {
  if (obligation.status !== "due") return obligation;
  switch (rules.lateRule) {
    case "not_eligible":
      return { ...obligation, status: "waived" };
    case "late_fee":
      return { amountDue: rules.lateFee, reason: "late_fee", status: "due" };
    case "lose_free_pass":
      return obligation;
  }
}

/** The pot is the fees actually paid, plus leftover birr carried in. Overpayments don't grow it. */
export function potFromObligations(obligations: Pick<ObligationTerms, "amountDue" | "status">[], carryIn: number) {
  return obligations.reduce((pot, item) => (item.status === "paid" ? pot + item.amountDue : pot), carryIn);
}
