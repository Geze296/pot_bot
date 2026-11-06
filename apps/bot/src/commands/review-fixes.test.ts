import { createFplClient, FplLeagueTooBigError } from "@potbot/fpl";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, BOB, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, calls, posts, world, reader } = harness;

const JAZZ = 7789411;
const KINGS = 4161001;
const NEW_GROUP = -100777;
const lastTo = (chatId: number) =>
  String(calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId).at(-1)?.payload.text);
const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });

async function setUp() {
  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  await harness.tick(new Date("2026-11-05T12:00:00Z"));
  posts.length = 0;
  calls.length = 0;
}

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  posts.length = 0;
  calls.length = 0;
  harness.telegram.down = false;
  harness.blockedChats.clear();
});
afterAll(() => db.$disconnect());

describe("a group upgrading to a supergroup, which changes its chat ID", () => {
  it("moves the league to the new ID, so posts and commands keep working", async () => {
    await setUp();
    await harness.say(OWNER, GROUP_ID, "x", { migrate_to_chat_id: NEW_GROUP });

    expect((await db.league.findFirstOrThrow()).telegramChatId).toBe(BigInt(NEW_GROUP));

    await harness.say(OWNER, NEW_GROUP, "/status");
    expect(lastTo(NEW_GROUP)).toContain("GW10");
  });

  it("also works from the message that arrives in the new group", async () => {
    await setUp();
    await harness.say(OWNER, NEW_GROUP, "x", { migrate_from_chat_id: GROUP_ID });

    expect((await db.league.findFirstOrThrow()).telegramChatId).toBe(BigInt(NEW_GROUP));
  });

  it("handles both messages arriving, and a group with no league", async () => {
    await setUp();
    await harness.say(OWNER, GROUP_ID, "x", { migrate_to_chat_id: NEW_GROUP });
    await harness.say(OWNER, NEW_GROUP, "x", { migrate_from_chat_id: GROUP_ID });
    await harness.say(OWNER, -5, "x", { migrate_to_chat_id: -6 });

    expect((await db.league.findFirstOrThrow()).telegramChatId).toBe(BigInt(NEW_GROUP));
  });
});

describe("/setup from an anonymous admin", () => {
  it("refuses, because Telegram doesn't say who they are, so they'd be locked out as owner", async () => {
    const anonymous = { id: 1087968824, first_name: "Group", username: "GroupAnonymousBot", is_bot: true };
    await harness.say(anonymous, GROUP_ID, `/setup ${LEAGUE_ID}`, {
      from: { ...anonymous },
      sender_chat: { id: GROUP_ID, type: "supergroup", title: "Office" },
    });

    expect(lastTo(GROUP_ID)).toContain("anonymous");
    expect(await db.league.count()).toBe(0);
  });
});

describe("/setup with a huge league", () => {
  it("stops paging quickly and explains", async () => {
    const row = (entry: number) => ({
      entry,
      entry_name: `T${entry}`,
      player_name: `P${entry}`,
      rank: entry,
      total: 0,
      event_total: 0,
    });
    let pages = 0;
    const fpl = createFplClient({
      sleep: async () => {},
      fetch: async () => {
        pages += 1;
        return new Response(
          JSON.stringify({
            league: { id: 314, name: "Overall", start_event: 1, scoring: "c" },
            standings: { has_next: true, results: Array.from({ length: 50 }, (_, index) => row(pages * 100 + index)) },
            new_entries: { has_next: false, results: [] },
          }),
        );
      },
    });

    await expect(fpl.getLeagueStandings(314)).rejects.toBeInstanceOf(FplLeagueTooBigError);
    expect(pages).toBeLessThan(10);
  });

  it("gives a clear message in the group", async () => {
    world.managers = Array.from({ length: 300 }, (_, index) => ({
      entry: index + 1,
      entry_name: `T${index}`,
      player_name: `P${index}`,
      rank: index,
      total: 0,
      event_total: 0,
    }));
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);

    expect(lastTo(GROUP_ID)).toContain("too big");
    expect(await db.league.count()).toBe(0);
  });
});

describe("hard rule 6: a transaction number is unique across the whole database", () => {
  it("refuses a member's payment using a number already recorded on a payout", async () => {
    await setUp();
    const league = await db.league.findFirstOrThrow();
    const { joinToken } = league;
    await harness.say(ALICE, ALICE.id, `/start join_${joinToken}`);
    await harness.tap(ALICE, ALICE.id, `claim:${(await memberOf(JAZZ)).id}`);
    await harness.say(OWNER, GROUP_ID, "/settelebirr Kibrom");

    const gw = await db.gameweek.findFirstOrThrow({ where: { fplEventId: 9 + 1 } });
    const result = await db.result.create({
      data: {
        gameweekId: gw.id,
        winnerMemberIds: [],
        runnerUpMemberIds: [],
        payoutAmount: 100,
        payoutShares: [{ memberId: (await memberOf(KINGS)).id, amount: 100 }],
      },
    });
    const owner = await db.user.findFirstOrThrow({ where: { telegramId: BigInt(OWNER.id) } });
    await db.payout.create({
      data: {
        resultId: result.id,
        memberId: (await memberOf(KINGS)).id,
        amount: 100,
        txnId: "SHARED1234",
        paidAt: new Date(),
        recordedBy: owner.id,
      },
    });

    reader.fails = false;
    reader.reading = {
      isTelebirrReceipt: true,
      successful: true,
      transactionNumber: "shared1234",
      transactionTo: "Kibrom",
      transactionTime: "2026/11/05 14:00:00",
      amount: 101,
    };
    await harness.photo(ALICE, ALICE.id);

    expect(lastTo(ALICE.id)).toContain("already been used");
    expect(await db.payment.count()).toBe(0);
  });
});

describe("claiming", () => {
  it("an old button can't claim a team that has left the league", async () => {
    await setUp();
    const { joinToken } = await db.league.findFirstOrThrow();
    await harness.say(BOB, BOB.id, `/start join_${joinToken}`);
    const jazz = await memberOf(JAZZ);
    await db.member.update({ where: { id: jazz.id }, data: { status: "left" } });

    await harness.tap(BOB, BOB.id, `claim:${jazz.id}`);

    expect((await memberOf(JAZZ)).userId).toBeNull();
  });
});

describe("a manual score before settling", () => {
  it("keeps FPL's bench and overall total, which tie-breaks and Bench Boss use", async () => {
    await setUp();
    await db.obligation.updateMany({ where: { status: "due" }, data: { status: "paid" } });
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    await harness.say(OWNER, GROUP_ID, `/override score ${JAZZ} 10 95`);

    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 50, total: 650, bench: 9 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    const after = new Date("2026-11-10T12:00:00Z");
    await harness.tick(after);
    await harness.tick(new Date(after.getTime() + 60 * 60 * 1000));

    const score = await db.score.findFirstOrThrow({ where: { memberId: (await memberOf(JAZZ)).id } });
    expect(score).toMatchObject({ points: 95, source: "manual", totalPoints: 650, benchPoints: 9 });
  });
});

describe("settling while a review is open", () => {
  it("retries telling the coordinator if the message fails", async () => {
    await setUp();
    const obligation = await db.obligation.findFirstOrThrow({
      where: { member: { fplEntryId: JAZZ }, gameweek: { fplEventId: 10 } },
    });
    await db.payment.create({
      data: {
        obligationId: obligation.id,
        amount: 100,
        method: "screenshot",
        verifyStatus: "needs_review",
        createdAt: new Date("2026-11-05T12:00:00Z"),
      },
    });
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    world.finished = { 10: {} };
    world.scores = { 10: {} };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    const after = new Date("2026-11-10T12:00:00Z");
    await harness.tick(after);
    posts.length = 0;

    harness.blockedChats.add(OWNER.id);
    await harness.tick(new Date(after.getTime() + 60 * 60 * 1000));
    harness.blockedChats.clear();
    expect(posts).toEqual([]);

    await harness.tick(new Date(after.getTime() + 2 * 60 * 60 * 1000));
    await harness.tick(new Date(after.getTime() + 3 * 60 * 60 * 1000));
    expect(posts.filter((post) => post.text.includes("still need your review"))).toHaveLength(1);
  });
});
