const GRACE_MS = 60 * 60 * 1000;

export interface SettleGateInput {
  eventId: number;
  eventFinished: boolean;
  eventDataChecked: boolean;
  statusRows: { event: number; bonus_added: boolean }[];
  leagues: string;
  /** When final data was first seen, from the last check. */
  finalSeenAt: Date | null;
  now: Date;
}

export interface SettleGate {
  finalSeenAt: Date | null;
  canSettle: boolean;
}

/**
 * Hard rule 4: bonus added and leagues updated, then one hour of grace. event-status only describes the current
 * gameweek, so once FPL has moved on, an older gameweek relies on FPL marking its data as checked instead.
 */
export function checkSettleGate(input: SettleGateInput): SettleGate {
  const { eventId, statusRows, finalSeenAt, now } = input;

  const movedOn = statusRows.some((row) => row.event > eventId);
  const isFinal = movedOn
    ? input.eventFinished && input.eventDataChecked
    : input.eventFinished &&
      statusRows.length > 0 &&
      statusRows.every((row) => row.event === eventId && row.bonus_added) &&
      input.leagues === "Updated";

  if (!isFinal) return { finalSeenAt: null, canSettle: false };
  if (!finalSeenAt) return { finalSeenAt: now, canSettle: false };
  return { finalSeenAt, canSettle: now.getTime() - finalSeenAt.getTime() >= GRACE_MS };
}
