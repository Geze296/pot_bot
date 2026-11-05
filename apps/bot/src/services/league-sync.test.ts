import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearDatabase,
  createHarness,
  fixtureManagers,
  GROUP_ID,
  LEAGUE_ID,
  OWNER,
  ALICE,
} from "../testing/harness.js";

const harness = createHarness();
const { db, posts, world } = harness;

const JAZZ = 7789411;
const NEWCOMER = {
  entry: 555,
  entry_name: "New Team",
  player_name: "New Person",
  rank: 12,
  total: 0,
  event_total: 0,
};
const BEFORE_DEADLINE = new Date("2026-11-05T12:00:00Z");
const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const withoutJazz = () => fixtureManagers().filter((manager) => (manager as { entry: number }).entry !== JAZZ);

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  await harness.tick(BEFORE_DEADLINE);
  posts.length = 0;
  harness.telegram.down = false;
});
afterAll(() => db.$disconnect());

describe("L4: hourly re-sync", () => {
  it("does nothing when the league hasn't changed", async () => {
    await harness.sync();

    expect(posts).toEqual([]);
    expect(await db.member.count()).toBe(11);
  });

  it("adds a new joiner, tells the group with a claim link, and charges them", async () => {
    world.managers = [...fixtureManagers(), NEWCOMER];
    await harness.sync();

    const newcomer = await memberOf(555);
    expect(newcomer).toMatchObject({ fplTeamName: "New Team", status: "active", userId: null });

    const { joinToken } = await db.league.findFirstOrThrow();
    expect(posts[0]?.text).toContain("New Team (New Person) joined");
    expect(posts[0]?.text).toContain(`https://t.me/pot_test_bot?start=join_${joinToken}`);

    await harness.tick(BEFORE_DEADLINE);
    const obligation = await db.obligation.findFirstOrThrow({ where: { memberId: newcomer.id } });
    expect(obligation).toMatchObject({ amountDue: 100, status: "due" });
  });

  it("flags a leaver without deleting them, and cancels what they owe", async () => {
    world.managers = withoutJazz();
    await harness.sync();

    const jazz = await memberOf(JAZZ);
    expect(jazz.status).toBe("left");
    expect(await db.member.count()).toBe(11);
    expect(posts[0]?.text).toContain("Jazz (Yabets M) has left");
    expect(await db.obligation.findFirstOrThrow({ where: { memberId: jazz.id } })).toMatchObject({ status: "waived" });
  });

  it("a leaver stops being reminded and charged, and can't be claimed", async () => {
    world.managers = withoutJazz();
    await harness.sync();
    posts.length = 0;

    await harness.tick(new Date("2026-11-06T17:30:00Z"));
    expect(posts.map((post) => post.text).join("\n")).not.toContain("Jazz");

    await harness.tick(new Date("2026-11-07T12:00:00Z"));
    const jazz = await memberOf(JAZZ);
    expect(await db.obligation.count({ where: { memberId: jazz.id, gameweek: { fplEventId: 11 } } })).toBe(0);

    const { joinToken } = await db.league.findFirstOrThrow();
    harness.calls.length = 0;
    await harness.say(ALICE, ALICE.id, `/start join_${joinToken}`);
    expect(
      harness
        .lastKeyboard()
        .flat()
        .map((button) => button.text)
        .join(),
    ).not.toContain("Jazz");
  });

  it("a fee a leaver already paid stands", async () => {
    const jazz = await memberOf(JAZZ);
    await db.obligation.updateMany({ where: { memberId: jazz.id }, data: { status: "paid" } });
    world.managers = withoutJazz();
    await harness.sync();

    expect(await db.obligation.findFirstOrThrow({ where: { memberId: jazz.id } })).toMatchObject({ status: "paid" });
  });

  it("brings back someone who rejoins", async () => {
    world.managers = withoutJazz();
    await harness.sync();
    posts.length = 0;
    delete world.managers;
    await harness.sync();

    expect((await memberOf(JAZZ)).status).toBe("active");
    expect(posts[0]?.text).toContain("Jazz (Yabets M) is back");
  });

  it("picks up a team name change quietly", async () => {
    world.managers = fixtureManagers().map((manager) =>
      (manager as { entry: number }).entry === JAZZ ? { ...(manager as object), entry_name: "Smooth Jazz" } : manager,
    );
    await harness.sync();

    expect((await memberOf(JAZZ)).fplTeamName).toBe("Smooth Jazz");
    expect(posts).toEqual([]);
  });

  it("running twice posts once (hard rule 7)", async () => {
    world.managers = withoutJazz();
    await harness.sync();
    await harness.sync();

    expect(posts).toHaveLength(1);
  });

  it("empty data from FPL flags nobody", async () => {
    world.managers = [];
    await harness.sync();

    expect(await db.member.count({ where: { status: "left" } })).toBe(0);
    expect(posts).toEqual([]);
  });

  it("FPL being down changes nothing", async () => {
    world.fail = true;
    await harness.sync();

    expect(await db.member.count({ where: { status: "active" } })).toBe(11);
    expect(posts).toEqual([]);
  });

  it("one league's failure doesn't stop the others", async () => {
    const OTHER_GROUP = -100999;
    const STRANGER = { id: 500, first_name: "Stranger", language_code: "en" };
    await harness.say(STRANGER, OTHER_GROUP, `/setup ${LEAGUE_ID}`);
    await harness.tap(STRANGER, OTHER_GROUP, "setup:confirm");
    const [first] = await db.league.findMany({ orderBy: { id: "asc" } });
    await db.league.update({ where: { id: first!.id }, data: { fplLeagueId: 999 } });

    world.managers = withoutJazz();
    await harness.sync();

    const stillActive = await db.member.count({ where: { leagueId: first!.id, status: "active" } });
    expect(stillActive).toBe(11);
    expect(posts.map((post) => post.chatId)).toEqual([BigInt(OTHER_GROUP)]);
  });
});
