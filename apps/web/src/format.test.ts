import { describe, expect, it } from "vitest";
import { changes, dateTime, signed, timeLeft } from "./format.js";

describe("dateTime", () => {
  it("shows the league's time zone, not the phone's", () => {
    expect(dateTime("2026-11-06T18:30:00Z", "Africa/Addis_Ababa")).toBe("Fri 6 Nov, 21:30");
  });
});

describe("timeLeft", () => {
  const deadline = "2026-11-06T18:30:00Z";

  it("rounds down", () => {
    expect(timeLeft(deadline, new Date("2026-11-05T12:00:30Z"))).toEqual({ days: 1, hours: 6, minutes: 29 });
  });

  it("is null at and after the deadline", () => {
    expect(timeLeft(deadline, new Date(deadline))).toBeNull();
    expect(timeLeft(deadline, new Date("2026-11-07T00:00:00Z"))).toBeNull();
  });
});

describe("signed", () => {
  it("marks gains", () => {
    expect(signed(800)).toBe("+800");
    expect(signed(-100)).toBe("-100");
    expect(signed(0)).toBe("0");
  });
});

describe("changes", () => {
  it("lists only what changed", () => {
    expect(changes({ status: "due", amount: 100 }, { status: "paid", amount: 100 })).toEqual(["status: due → paid"]);
  });

  it("shows something added as just its value", () => {
    expect(changes({}, { member: "Abel" })).toEqual(["member: Abel"]);
    expect(changes({ name: null }, { name: "Kibrom" })).toEqual(["name: Kibrom"]);
  });

  it("leaves out empty values on both sides", () => {
    expect(changes({}, { txnId: null, amount: 500 })).toEqual(["amount: 500"]);
    expect(changes(null, null)).toEqual([]);
  });

  it("shows something removed", () => {
    expect(changes({ userId: "Abel" }, { userId: null })).toEqual(["userId: Abel → –"]);
  });

  it("uses friendly labels", () => {
    expect(changes({ a: 1 }, { a: 2 }, () => "Status")).toEqual(["Status: 1 → 2"]);
  });
});
