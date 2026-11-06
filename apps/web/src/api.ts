import { initData } from "./telegram.js";

/** A refusal from the server. Its code picks the message to show. */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `tma ${initData()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(data?.error ?? "server_error");
  return data as T;
}

export type Role = "owner" | "coordinator" | "member";

export interface LeagueRef {
  id: number;
  name: string;
  role: Role;
}

export interface Me {
  name: string;
  leagues: LeagueRef[];
}

export interface Dashboard {
  role: Role;
  timezone: string;
  team: string | null;
  yourStatus: { status: string; reason: string; amountDue: number } | null;
  yourPaymentInReview: boolean;
  receiver: string | null;
  gameweek: { event: number; deadlineAt: string; status: string } | null;
  pot: number;
  paid: string[];
  freePass: string[];
  inReview: string[];
  unpaid: string[];
  out: string[];
  lastResult: { event: number; winners: string[] } | null;
}

export interface TableRow {
  team: string;
  value: number;
  rank: number;
}

export interface LiveTable {
  yourTeam: string | null;
  table: { event: number; finished: boolean; gameweek: TableRow[]; overall: TableRow[] } | null;
}

export interface Payments {
  timezone: string;
  gameweek: { event: number; status: string } | null;
  reviews: {
    id: number;
    manager: string;
    team: string;
    gameweek: number;
    reason: string | null;
    txnId: string | null;
    paidAt: string | null;
    hasScreenshot: boolean;
  }[];
  members: { memberId: number; manager: string; team: string; status: string; reason: string; amountDue: number }[];
}

export interface Results {
  gameweeks: {
    event: number;
    status: string;
    pot: number;
    result: {
      source: string;
      winners: string[];
      runnersUp: string[];
      carryOut: number;
      shares: { memberId: number; manager: string; amount: number; paid: boolean; txnId: string | null }[];
    } | null;
    scores: {
      memberId: number;
      manager: string;
      team: string;
      points: number;
      transferCost: number;
      net: number;
      rank: number | null;
      source: string;
    }[];
  }[];
  members: { memberId: number; manager: string; team: string }[];
}

export interface Ledger {
  canExport: boolean;
  members: {
    memberId: number;
    manager: string;
    team: string;
    paidIn: number;
    won: number;
    received: number;
    net: number;
  }[];
  weeks: {
    gameweek: number;
    memberId: number;
    reason: string;
    status: string;
    paid: number;
    won: number;
    received: number;
  }[];
}

export interface Members {
  members: {
    id: number;
    entry: number;
    manager: string;
    team: string;
    status: string;
    roastOptOut: boolean;
    userId: number | null;
    claimedBy: string | null;
    username: string | null;
    facts: { id: number; fact: string }[];
  }[];
  coordinatorUserId: number | null;
  ownerUserId: number;
}

export interface Rules {
  role: Role;
  rules: Record<string, string | number | number[]>;
  options: Record<string, string[]>;
  telebirrName: string | null;
  persona: { name: string; spice: number };
  personas: string[];
}

export interface Audit {
  timezone: string;
  entries: {
    id: number;
    at: string;
    actor: string;
    action: string;
    subject: string;
    before: unknown;
    after: unknown;
  }[];
}
