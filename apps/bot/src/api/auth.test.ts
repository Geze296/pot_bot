import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signInitData } from "../testing/init-data.js";
import { signingKey, verifyInitData } from "./auth.js";

const TOKEN = "123:real-token";
const NOW = new Date("2026-11-10T12:00:00Z");
const ALICE = { id: 42, first_name: "Alice" };
const HOUR = 60 * 60 * 1000;

describe("verifyInitData", () => {
  it("matches a known result computed separately with Telegram's documented method", () => {
    const key = createHmac("sha256", "WebAppData").update(TOKEN).digest();

    expect(signingKey(TOKEN).equals(key)).toBe(true);
  });

  it("accepts what Telegram signed", () => {
    expect(verifyInitData(signInitData(ALICE, TOKEN, NOW), TOKEN, NOW)).toEqual(ALICE);
  });

  it("refuses a different bot's signature", () => {
    expect(verifyInitData(signInitData(ALICE, "999:other", NOW), TOKEN, NOW)).toBeNull();
  });

  it("refuses someone changing who they are", () => {
    const params = new URLSearchParams(signInitData(ALICE, TOKEN, NOW));
    params.set("user", JSON.stringify({ id: 1, first_name: "Owner" }));

    expect(verifyInitData(params.toString(), TOKEN, NOW)).toBeNull();
  });

  it("refuses data older than 24 hours, and accepts just inside it", () => {
    const old = (ms: number) => signInitData(ALICE, TOKEN, new Date(NOW.getTime() - ms));

    expect(verifyInitData(old(24 * HOUR + 2000), TOKEN, NOW)).toBeNull();
    expect(verifyInitData(old(23 * HOUR), TOKEN, NOW)).toEqual(ALICE);
  });

  it.each(["", "hash=", "hash=abc", "user=%7B%7D", "not data at all", "hash=zz&user=x"])("refuses %j", (initData) => {
    expect(verifyInitData(initData, TOKEN, NOW)).toBeNull();
  });

  it("refuses a valid signature with no real user in it", () => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(NOW.getTime() / 1000)), user: "{}" });
    const check = [...params.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("\n");
    params.set("hash", createHmac("sha256", signingKey(TOKEN)).update(check).digest("hex"));

    expect(verifyInitData(params.toString(), TOKEN, NOW)).toBeNull();
  });
});
