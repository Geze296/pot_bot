import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, BOB, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db } = harness;

beforeEach(async () => {
  await clearDatabase(db);
  harness.calls.length = 0;
});
afterAll(() => db.$disconnect());

async function linkLeague(firstPotGw?: number) {
  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}${firstPotGw ? ` ${firstPotGw}` : ""}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
}

const memberByManager = (name: string) => db.member.findFirstOrThrow({ where: { fplManagerName: name } });

describe("L1: /setup links a group to a classic league", () => {
  it("shows the league name and every manager", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup https://fantasy.premierleague.com/en/leagues/${LEAGUE_ID}/standings/c`);

    const [preview] = harness.takeTexts();
    expect(preview).toContain("Office");
    expect(preview).toContain("11 managers");
    expect(preview).toContain("Jazz (Yabets M)");
    expect(preview).toContain("Ephrem (Ephrem T)");
    expect(await db.member.count()).toBe(11);
  });

  it("gives a clear error for a wrong ID", async () => {
    await harness.say(OWNER, GROUP_ID, "/setup 999");

    expect(harness.takeTexts()[0]).toContain("couldn't find FPL classic league 999");
    expect(await db.league.count()).toBe(0);
  });

  it("explains that an invite link can't be used", async () => {
    await harness.say(OWNER, GROUP_ID, "/setup https://fantasy.premierleague.com/leagues/auto-join/iyrwt4");

    expect(harness.takeTexts()[0]).toContain("invite link");
  });

  it("asks for a league when given nothing", async () => {
    await harness.say(OWNER, GROUP_ID, "/setup");

    expect(harness.takeTexts()[0]).toContain("Paste your FPL league ID");
  });

  it("refuses to run in private chat", async () => {
    await harness.say(OWNER, OWNER.id, `/setup ${LEAGUE_ID}`);

    expect(harness.takeTexts()[0]).toContain("group chat");
  });

  it("refuses someone who isn't a group admin", async () => {
    const memberHarness = createHarness({ chatMemberStatus: "member" });
    await memberHarness.say(ALICE, GROUP_ID, `/setup ${LEAGUE_ID}`);

    expect(memberHarness.takeTexts()[0]).toContain("Only a group admin");
    expect(await db.league.count()).toBe(0);
    await memberHarness.db.$disconnect();
  });

  it("lets only the owner confirm", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await harness.tap(ALICE, GROUP_ID, "setup:confirm");

    const league = await db.league.findFirstOrThrow();
    expect(league.setupState).toBe("awaiting_confirm");
    expect(harness.calls.at(-1)?.payload.text).toContain("Only the league owner");
  });

  it("cancels cleanly", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await harness.tap(OWNER, GROUP_ID, "setup:cancel");

    expect(await db.league.count()).toBe(0);
    expect(await db.member.count()).toBe(0);
  });

  it("never replaces a linked league", async () => {
    await linkLeague(10);
    harness.takeTexts();
    await harness.say(OWNER, GROUP_ID, "/setup 999");

    expect(harness.takeTexts()[0]).toContain("already linked to Office");
    expect(await db.member.count()).toBe(11);
  });
});

describe("first pot gameweek", () => {
  it("refuses a first gameweek outside the league's range", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID} 11`);

    expect(harness.takeTexts()[0]).toContain("between GW1 and GW10");
    expect(await db.league.count()).toBe(0);
  });

  it("starts at the next gameweek by itself, records no past results, and seeds the previous runner-up's free pass", async () => {
    await linkLeague();

    const league = await db.league.findFirstOrThrow();
    const ephrem = await memberByManager("Ephrem T");
    expect(league.setupState).toBe("active");
    expect(league.firstPotGw).toBe(10);
    expect(league.seedFreePassMemberIds).toEqual([ephrem.id]);

    expect(await db.score.count()).toBe(0);
    expect(await db.result.count()).toBe(0);

    const gameweeks = await db.gameweek.findMany({ orderBy: { fplEventId: "asc" } });
    expect(gameweeks[0]?.fplEventId).toBe(10);
    expect(gameweeks.at(-1)?.fplEventId).toBe(38);
    expect(gameweeks[0]?.status).toBe("open");
    expect(gameweeks[0]?.paymentOpensAt.toISOString()).toBe("2026-10-31T11:00:00.000Z");
    expect(gameweeks[0]?.paymentClosesAt.toISOString()).toBe("2026-11-06T18:30:00.000Z");

    const texts = harness.takeTexts().join("\n");
    expect(texts).toContain("First pot gameweek: GW10");
    expect(texts).toContain("Free pass for GW10: Ephrem T (runner-up in GW9)");
    expect(texts).toContain("GW10 deadline: Fri 6 Nov, 21:30");
    expect(texts).not.toContain("winner");
  });

  it("posts a deep link for members to claim a team", async () => {
    await linkLeague(10);

    const league = await db.league.findFirstOrThrow();
    const button = harness.lastKeyboard().flat()[0];
    expect(button?.url).toBe(`https://t.me/pot_test_bot?start=join_${league.joinToken}`);
  });

  it("a double tap doesn't run setup twice", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await harness.tap(OWNER, GROUP_ID, "setup:confirm");
    harness.takeTexts();
    await harness.tap(OWNER, GROUP_ID, "setup:confirm");

    expect(harness.takeTexts()).toEqual([]);
  });

  it("lets the owner retry when FPL fails during backfill", async () => {
    const failing = createHarness({ failHistories: true });
    await failing.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await failing.tap(OWNER, GROUP_ID, "setup:confirm");

    const league = await db.league.findFirstOrThrow();
    expect(league.setupState).toBe("awaiting_confirm");
    expect(await db.gameweek.count()).toBe(0);
    expect(failing.takeTexts().join("\n")).toContain("can't reach FPL");
    await failing.db.$disconnect();

    await harness.tap(OWNER, GROUP_ID, "setup:confirm");
    expect((await db.league.findFirstOrThrow()).setupState).toBe("active");
  });
});

describe("L2: backfill", () => {
  // Winners and runners-up printed by scripts/check-league.mjs for our real league.
  const expected: [number, string[], string[]][] = [
    [1, ["Natnael Malike"], ["Yabets M"]],
    [2, ["Natnael Tessema"], ["Yabets M"]],
    [3, ["KB Gselassie"], ["Geze 29"]],
    [4, ["Yabets M"], ["Yohannes Gossaye"]],
    [5, ["Yabets M"], ["Nati Zed"]],
    [6, ["KB Gselassie"], ["Geze 29"]],
    [7, ["KB Gselassie"], ["Natnael Malike"]],
    [8, ["Nati Zed"], ["Geze 29"]],
    [9, ["Yabets M"], ["Ephrem T"]],
  ];

  it("reproduces every winner and runner-up the check script printed", async () => {
    await linkLeague(1);

    const members = await db.member.findMany();
    const names = (ids: number[]) => ids.map((id) => members.find((member) => member.id === id)?.fplManagerName);
    const gameweeks = await db.gameweek.findMany({
      where: { status: "settled" },
      include: { result: true },
      orderBy: { fplEventId: "asc" },
    });

    expect(
      gameweeks.map((gameweek) => [
        gameweek.fplEventId,
        names(gameweek.result!.winnerMemberIds),
        names(gameweek.result!.runnerUpMemberIds),
      ]),
    ).toEqual(expected);
  });

  it("stores points and cost separately, and ranks by net score", async () => {
    await linkLeague(9);

    const natFc = await memberByManager("Natnael Tessema");
    const score = await db.score.findFirstOrThrow({ where: { memberId: natFc.id } });
    expect(score.points).toBe(52);
    expect(score.transferCost).toBe(8);
    expect(score.source).toBe("fpl");
  });

  it("leaves out a manager who hadn't started that gameweek", async () => {
    await linkLeague(1);

    const ephrem = await memberByManager("Ephrem T");
    expect(await db.score.count({ where: { memberId: ephrem.id } })).toBe(1);
  });

  it("posts a season table, using net scores", async () => {
    await linkLeague(9);

    const texts = harness.takeTexts().join("\n");
    expect(texts).toContain("Season so far:");
    expect(texts).toContain("GW9: winner Yabets M (75). Runner-up Ephrem T (67).");
  });

  it("re-running doesn't duplicate or overwrite a manual score", async () => {
    await linkLeague(9);
    const score = await db.score.findFirstOrThrow();
    await db.score.update({ where: { id: score.id }, data: { points: 1, source: "manual" } });
    const before = await db.score.count();

    const { backfillSeason } = await import("../services/league-setup.js");
    const { createFplClient } = await import("@potbot/fpl");
    const { fixtureFetch } = await import("../testing/harness.js");
    const league = await db.league.findFirstOrThrow();
    await backfillSeason(db, createFplClient({ fetch: fixtureFetch(), sleep: async () => {} }), {
      leagueId: league.id,
      firstPotGw: 9,
    });

    expect(await db.score.count()).toBe(before);
    expect((await db.score.findUniqueOrThrow({ where: { id: score.id } })).points).toBe(1);
  });
});

describe("L3: claiming a team", () => {
  async function joinLink() {
    await linkLeague(10);
    const { joinToken } = await db.league.findFirstOrThrow();
    harness.takeTexts();
    return `/start join_${joinToken}`;
  }

  it("lists unclaimed teams, and a claimed team disappears for the next person", async () => {
    const link = await joinLink();

    await harness.say(ALICE, ALICE.id, link);
    const jazz = harness
      .lastKeyboard()
      .flat()
      .find((button) => button.text.startsWith("Jazz"));
    expect(harness.lastKeyboard().flat()).toHaveLength(11);

    await harness.tap(ALICE, ALICE.id, jazz!.callback_data!);
    expect(harness.takeTexts().at(-1)).toContain("linked to Jazz");

    await harness.say(BOB, BOB.id, link);
    const buttons = harness
      .lastKeyboard()
      .flat()
      .map((button) => button.text);
    expect(buttons).toHaveLength(10);
    expect(buttons.some((text) => text.startsWith("Jazz"))).toBe(false);
  });

  it("a team can be claimed only once", async () => {
    const link = await joinLink();
    await harness.say(ALICE, ALICE.id, link);
    await harness.say(BOB, BOB.id, link);
    const jazz = await memberByManager("Yabets M");

    await harness.tap(ALICE, ALICE.id, `claim:${jazz.id}`);
    await harness.tap(BOB, BOB.id, `claim:${jazz.id}`);

    const owner = await db.member.findUniqueOrThrow({ where: { id: jazz.id }, include: { user: true } });
    expect(owner.user?.telegramId).toBe(BigInt(ALICE.id));
    expect(harness.takeTexts().at(-1)).toContain("which team is yours");
  });

  it("a person can claim only one team per league", async () => {
    const link = await joinLink();
    await harness.say(ALICE, ALICE.id, link);
    const jazz = await memberByManager("Yabets M");
    const kings = await memberByManager("KB Gselassie");

    await harness.tap(ALICE, ALICE.id, `claim:${jazz.id}`);
    await harness.tap(ALICE, ALICE.id, `claim:${kings.id}`);

    expect((await db.member.findUniqueOrThrow({ where: { id: kings.id } })).userId).toBeNull();
    expect(harness.takeTexts().at(-1)).toContain("already linked to Jazz");
  });

  it("says so when someone who already claimed opens the link again", async () => {
    const link = await joinLink();
    await harness.say(ALICE, ALICE.id, link);
    const jazz = await memberByManager("Yabets M");
    await harness.tap(ALICE, ALICE.id, `claim:${jazz.id}`);
    harness.takeTexts();

    await harness.say(ALICE, ALICE.id, link);

    expect(harness.takeTexts()[0]).toContain("already linked to Jazz");
  });

  it("rejects a bad link", async () => {
    await harness.say(ALICE, ALICE.id, "/start join_nope");

    expect(harness.takeTexts()[0]).toContain("isn't valid");
  });

  it("plain /start still gets the welcome", async () => {
    await harness.say(ALICE, ALICE.id, "/start");

    expect(harness.takeTexts()[0]).toContain("Hi Alice!");
  });
});

describe("L3: the owner can link and unlink anyone", () => {
  const replyTo = (person: typeof ALICE) => ({
    reply_to_message: {
      message_id: 5,
      date: 0,
      chat: { id: GROUP_ID, type: "supergroup" },
      from: { is_bot: false, ...person },
    },
  });
  const JAZZ_ENTRY = 7789411;

  it("links by replying to someone, and writes to the audit log", async () => {
    await linkLeague(10);
    harness.takeTexts();
    await harness.say(OWNER, GROUP_ID, `/link ${JAZZ_ENTRY}`, replyTo(ALICE));

    expect(harness.takeTexts()[0]).toContain("Alice is now linked to Jazz");
    const member = await db.member.findFirstOrThrow({ where: { fplEntryId: JAZZ_ENTRY }, include: { user: true } });
    expect(member.user?.telegramId).toBe(BigInt(ALICE.id));

    const owner = await db.user.findUniqueOrThrow({ where: { telegramId: BigInt(OWNER.id) } });
    const audit = await db.auditLog.findFirstOrThrow();
    expect(audit).toMatchObject({ action: "member.link", entityId: member.id, actorId: owner.id });
  });

  it("unlinks, and writes to the audit log", async () => {
    await linkLeague(10);
    await harness.say(OWNER, GROUP_ID, `/link ${JAZZ_ENTRY}`, replyTo(ALICE));
    harness.takeTexts();
    await harness.say(OWNER, GROUP_ID, `/unlink ${JAZZ_ENTRY}`);

    expect(harness.takeTexts()[0]).toContain("Jazz is no longer linked");
    expect((await db.member.findFirstOrThrow({ where: { fplEntryId: JAZZ_ENTRY } })).userId).toBeNull();
    expect(await db.auditLog.count({ where: { action: "member.unlink" } })).toBe(1);
  });

  it("refuses anyone but the owner", async () => {
    await linkLeague(10);
    harness.takeTexts();
    await harness.say(ALICE, GROUP_ID, `/link ${JAZZ_ENTRY}`, replyTo(ALICE));
    await harness.say(ALICE, GROUP_ID, `/unlink ${JAZZ_ENTRY}`);

    expect(harness.takeTexts()).toEqual([
      expect.stringContaining("Only the league owner"),
      expect.stringContaining("Only the league owner"),
    ]);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("won't overwrite an existing link or give someone a second team", async () => {
    await linkLeague(10);
    await harness.say(OWNER, GROUP_ID, `/link ${JAZZ_ENTRY}`, replyTo(ALICE));
    harness.takeTexts();

    await harness.say(OWNER, GROUP_ID, `/link ${JAZZ_ENTRY}`, replyTo(BOB));
    expect(harness.takeTexts()[0]).toContain("already linked");

    await harness.say(OWNER, GROUP_ID, "/link 4161001", replyTo(ALICE));
    expect(harness.takeTexts()[0]).toContain("already linked to another team");
    expect(await db.auditLog.count()).toBe(1);
  });

  it("needs a reply and a team that's in the league", async () => {
    await linkLeague(10);
    harness.takeTexts();

    await harness.say(OWNER, GROUP_ID, `/link ${JAZZ_ENTRY}`);
    expect(harness.takeTexts()[0]).toContain("Reply to someone's message");

    await harness.say(OWNER, GROUP_ID, "/link 5", replyTo(ALICE));
    expect(harness.takeTexts()[0]).toContain("No team with ID 5");
  });
});
