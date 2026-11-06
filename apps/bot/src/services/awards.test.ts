import { computeAwards } from "@potbot/core";
import { createFplClient } from "@potbot/fpl";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ALICE,
  clearDatabase,
  createHarness,
  fixtureFetch,
  fixtureManagers,
  GROUP_ID,
  LEAGUE_ID,
  OWNER,
} from "../testing/harness.js";
import { awardInputs, storedAwards } from "./awards.js";

const harness = createHarness();
const { db, world, posts, calls } = harness;

const HOUR = 60 * 60 * 1000;
const AFTER_MATCHES = new Date("2026-11-10T12:00:00Z");
const JAZZ = 7789411;
const NAT_FC = 3052815;
const AKAKI = 10410646;
const EPHREM = 11201236;

describe("the real GW9, worked out by hand from the saved data", () => {
  const managers = fixtureManagers() as { entry: number }[];
  const members = managers.map((manager) => ({ id: manager.entry, fplEntryId: manager.entry }));

  async function realInputs() {
    const fpl = createFplClient({ fetch: fixtureFetch(), sleep: async () => {} });
    const histories = await fpl.getEntryHistories(managers.map((manager) => manager.entry));
    const scores = managers.map((manager) => {
      const week = histories.get(manager.entry)!.current.find((row) => row.event === 9)!;
      return {
        memberId: manager.entry,
        points: week.points,
        transferCost: week.event_transfers_cost,
        benchPoints: week.points_on_bench,
      };
    });
    return { fpl, inputs: await awardInputs(fpl, { event: 9, members, scores, grossScores: false }) };
  }

  it("gets every award right", async () => {
    const { fpl, inputs } = await realInputs();
    const awards = await storedAwards(fpl, inputs);

    expect(awards.woodenSpoon).toEqual({ memberIds: [NAT_FC, AKAKI], value: 44 });
    expect(awards.benchBoss).toEqual({ memberIds: [EPHREM], value: 23 });
    expect(awards.hitMan).toEqual({ memberIds: [NAT_FC], value: 8 });
    expect(awards.genius).toMatchObject({ memberIds: [JAZZ], value: 15, player: "Van Hecke" });
    // Nine of the eleven had a captain on 2 points. Geze and Dave7 had 9.
    expect(awards.captainCalamity?.value).toBe(2);
    expect(awards.captainCalamity?.memberIds).toHaveLength(9);
    expect(awards.captainCalamity?.memberIds).not.toContain(6646796);
    expect(awards.captainCalamity?.memberIds).not.toContain(11154015);
  });

  it("uses the real captain's points before doubling", async () => {
    const { inputs } = await realInputs();

    expect(inputs.find((input) => input.memberId === JAZZ)?.captain?.points).toBe(2);
    expect(computeAwards(inputs).captainCalamity?.value).toBe(2);
  });
});

describe("posting", () => {
  const awardPosts = () => posts.filter((post) => post.text.includes("awards"));

  async function settle() {
    const due = await db.obligation.findMany({ where: { status: "due", gameweek: { fplEventId: 10 } } });
    for (const obligation of due) {
      await db.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });
    }
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 }, [NAT_FC]: { points: 20, cost: 8 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    await harness.tick(AFTER_MATCHES);
    await harness.tick(new Date(AFTER_MATCHES.getTime() + HOUR));
  }

  beforeEach(async () => {
    await clearDatabase(db);
    for (const key of Object.keys(world)) delete world[key as keyof typeof world];
    harness.telegram.down = false;
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await harness.tap(OWNER, GROUP_ID, "setup:confirm");
    await harness.tick(new Date("2026-11-01T12:00:00Z"));
    posts.length = 0;
    calls.length = 0;
  });
  afterAll(() => db.$disconnect());

  it("posts awards right after the results, using the settled scores", async () => {
    await settle();

    const results = posts.findIndex((post) => post.text.includes("results are final"));
    const awards = posts.findIndex((post) => post.text.includes("GW10 awards"));
    expect(results).toBeGreaterThanOrEqual(0);
    expect(awards).toBeGreaterThan(results);

    const text = posts[awards]!.text;
    expect(text).toContain("🥄 Wooden Spoon: Natnael Tessema, on 12 points");
    expect(text).toContain("💸 Hit Man: Natnael Tessema, who spent 8 points");
    expect(text).toContain("The Genius: Yabets M, the only one brave enough to start Van Hecke (15 points)");
    expect(posts[awards]?.chatId).toBe(BigInt(GROUP_ID));
  });

  it("records captain points on the score", async () => {
    await settle();

    const jazz = await db.member.findFirstOrThrow({ where: { fplEntryId: JAZZ } });
    expect((await db.score.findFirstOrThrow({ where: { memberId: jazz.id } })).captainPoints).toBe(2);
  });

  it("posts once, however many ticks run", async () => {
    await settle();
    await harness.tick(new Date(AFTER_MATCHES.getTime() + 2 * HOUR));

    expect(awardPosts()).toHaveLength(1);
  });

  it("a Telegram failure retries the awards later, once", async () => {
    await settle();
    expect(awardPosts()).toHaveLength(1);
    posts.length = 0;
    await db.messageLog.deleteMany({ where: { dedupeKey: "awards:gw10" } });

    harness.telegram.down = true;
    await harness.tick(new Date(AFTER_MATCHES.getTime() + 2 * HOUR));
    harness.telegram.down = false;
    expect(awardPosts()).toEqual([]);

    await harness.tick(new Date(AFTER_MATCHES.getTime() + 3 * HOUR));
    await harness.tick(new Date(AFTER_MATCHES.getTime() + 4 * HOUR));
    expect(awardPosts()).toHaveLength(1);
  });

  it("FPL failing on picks doesn't stop the results, and awards follow later", async () => {
    const due = await db.obligation.findMany({ where: { status: "due", gameweek: { fplEventId: 10 } } });
    for (const obligation of due) {
      await db.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });
    }
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    world.failLive = true;
    await harness.tick(AFTER_MATCHES);
    await harness.tick(new Date(AFTER_MATCHES.getTime() + HOUR));

    expect(posts.some((post) => post.text.includes("results are final"))).toBe(true);
    expect(awardPosts()).toEqual([]);

    world.failLive = false;
    await harness.tick(new Date(AFTER_MATCHES.getTime() + 2 * HOUR));
    expect(awardPosts()).toHaveLength(1);
  });

  it("/awards shows the latest, in the group and in private, without calling FPL", async () => {
    await settle();
    const jazz = await db.member.findFirstOrThrow({ where: { fplEntryId: JAZZ } });
    const user = await db.user.create({ data: { telegramId: BigInt(ALICE.id), displayName: "Alice" } });
    await db.member.update({ where: { id: jazz.id }, data: { userId: user.id } });
    world.fail = true;

    for (const chat of [GROUP_ID, ALICE.id]) {
      calls.length = 0;
      await harness.say(ALICE, chat, "/awards");
      const text = String(calls.find((call) => call.method === "sendMessage")?.payload.text);
      expect(text).toContain("GW10 awards");
      expect(text).toContain("Wooden Spoon");
    }
  });

  it("/awards says so before any gameweek has settled", async () => {
    await harness.say(ALICE, GROUP_ID, "/awards");

    expect(String(calls.at(-1)?.payload.text)).toContain("no awards to show yet");
  });
});
