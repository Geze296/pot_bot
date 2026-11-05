export interface LedgerRow {
  memberId: number;
  paidIn: number;
  won: number;
  net: number;
}

export function memberLedger(input: {
  payments: { memberId: number; amount: number }[];
  payouts: { memberId: number; amount: number }[];
}): LedgerRow[] {
  const rows = new Map<number, LedgerRow>();
  const rowFor = (memberId: number): LedgerRow => {
    const row = rows.get(memberId) ?? { memberId, paidIn: 0, won: 0, net: 0 };
    rows.set(memberId, row);
    return row;
  };

  for (const { memberId, amount } of input.payments) rowFor(memberId).paidIn += amount;
  for (const { memberId, amount } of input.payouts) rowFor(memberId).won += amount;
  for (const row of rows.values()) row.net = row.won - row.paidIn;

  return [...rows.values()].sort((a, b) => a.memberId - b.memberId);
}
