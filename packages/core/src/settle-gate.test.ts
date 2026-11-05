import { describe, expect, it } from "vitest";
import { checkSettleGate, type SettleGateInput } from "./settle-gate.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const base: SettleGateInput = {
  eventId: 10,
  eventFinished: true,
  eventDataChecked: false,
  statusRows: [
    { event: 10, bonus_added: true },
    { event: 10, bonus_added: true },
  ],
  leagues: "Updated",
  finalSeenAt: null,
  now: NOW,
};

describe("checkSettleGate (hard rule 4)", () => {
  it("first sighting of final data starts the grace period, but doesn't settle", () => {
    expect(checkSettleGate(base)).toEqual({ finalSeenAt: NOW, canSettle: false });
  });

  it("not before the hour is up", () => {
    const seen = new Date(NOW.getTime() - HOUR + 1);
    expect(checkSettleGate({ ...base, finalSeenAt: seen })).toEqual({ finalSeenAt: seen, canSettle: false });
  });

  it("settles once the hour is up", () => {
    const seen = new Date(NOW.getTime() - HOUR);
    expect(checkSettleGate({ ...base, finalSeenAt: seen })).toEqual({ finalSeenAt: seen, canSettle: true });
  });

  const seenLongAgo = new Date(NOW.getTime() - 5 * HOUR);

  it("waits if any day's bonus isn't added, and restarts the grace period", () => {
    const statusRows = [
      { event: 10, bonus_added: true },
      { event: 10, bonus_added: false },
    ];
    expect(checkSettleGate({ ...base, statusRows, finalSeenAt: seenLongAgo })).toEqual({
      finalSeenAt: null,
      canSettle: false,
    });
  });

  it("waits until leagues are updated", () => {
    expect(checkSettleGate({ ...base, leagues: "Updating", finalSeenAt: seenLongAgo }).canSettle).toBe(false);
  });

  it("waits while FPL says the gameweek isn't finished", () => {
    expect(checkSettleGate({ ...base, eventFinished: false, finalSeenAt: seenLongAgo }).canSettle).toBe(false);
  });

  it("waits when the status has no rows", () => {
    expect(checkSettleGate({ ...base, statusRows: [], finalSeenAt: seenLongAgo }).canSettle).toBe(false);
  });

  it("waits when the status is about an earlier gameweek", () => {
    const statusRows = [{ event: 9, bonus_added: true }];
    expect(checkSettleGate({ ...base, statusRows, finalSeenAt: seenLongAgo }).canSettle).toBe(false);
  });

  it("a later gameweek's status counts only if FPL has fully checked this one", () => {
    const statusRows = [{ event: 11, bonus_added: false }];
    const leagues = "";

    expect(checkSettleGate({ ...base, statusRows, leagues, finalSeenAt: seenLongAgo }).canSettle).toBe(false);
    expect(
      checkSettleGate({ ...base, statusRows, leagues, eventDataChecked: true, finalSeenAt: seenLongAgo }).canSettle,
    ).toBe(true);
  });
});
