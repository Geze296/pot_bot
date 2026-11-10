import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { leagueLedger } from "../services/ledger.js";
import { ALICE, BOB, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, calls, posts, world, clock } = harness;

const DEADLINE = new Date("2026-11-06T18:30:00Z");
const AFTER_MATCHES = new Date("2026-11-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const before = (hours: number) => new Date(DEADLINE.getTime() - hours * HOUR);

const JAZZ = 7789411;
const KINGS = 4161001;
const NAT_FC = 3052815;
const ALICE_U = { ...ALICE, username: "alice_fpl" };

const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const pollCalls = () => calls.filter((call) => call.method === "sendPoll");
const lastTo = (chatId: number) =>
  calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId).at(-1)?.payload;
const gw10 = () => db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } });
const votes = () => db.prediction.findMany({ include: { member: true, picked: true }, orderBy: { id: "asc" } });

/** Which poll option is this team. */
async function optionFor(entry: number): Promise<number> {
  const { pollOptions } = await gw10();
  return pollOptions.indexOf((await memberOf(entry)).id);
}

async function vote(person: typeof ALICE, entry: number | null) {
  const { pollId } = await gw10();
  await harness.vote(person, pollId!, entry === null ? [] : [await optionFor(entry)]);
}

async function payEveryone() {
  const obligations = await db.obligation.findMany({ where: { gameweek: { fplEventId: 10 }, status: "due" } });
  for (const obligation of obligations) {
    await db.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });
    await db.payment.create({
      data: {
        obligationId: obligation.id,
        amount: obligation.amountDue,
        paidAt: before(30),
        method: "manual",
        verifyStatus: "verified",
      },
    });
  }
}

async function settleGw10(scores: Record<number, { points: number }>) {
  world.finished = { ...world.finished, [10]: {} };
  world.scores = { ...world.scores, [10]: scores };
  world.eventStatus = {
    status: [{ bonus_added: true, date: "2026-11-09", event: 10, points: "r" }],
    leagues: "Updated",
  };
  await harness.tick(AFTER_MATCHES);
  await harness.tick(new Date(AFTER_MATCHES.getTime() + HOUR));
}

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  clock.now = new Date("2026-11-05T12:00:00Z");

  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  const { joinToken } = await db.league.findFirstOrThrow();
  await harness.say(ALICE_U, ALICE.id, `/start join_${joinToken}`);
  await harness.tap(ALICE_U, ALICE.id, `claim:${(await memberOf(JAZZ)).id}`);
  await harness.say(BOB, BOB.id, `/start join_${joinToken}`);
  await harness.tap(BOB, BOB.id, `claim:${(await memberOf(KINGS)).id}`);
  await harness.tick(before(30));
  calls.length = 0;
  posts.length = 0;
});
afterAll(() => db.$disconnect());

describe("the poll", () => {
  it("goes up in the group 24 hours before the deadline, once", async () => {
    await harness.tick(before(25));
    expect(pollCalls()).toEqual([]);

    await harness.tick(before(24));
    await harness.tick(before(23));
    await harness.tick(before(6));

    expect(pollCalls()).toHaveLength(1);
    const poll = pollCalls()[0]!.payload as { chat_id: number; question: string; options: { text: string }[] };
    expect(poll.chat_id).toBe(GROUP_ID);
    expect(poll.question).toBe("Who wins GW10? Bragging rights only.");
    // Everyone still in the league, by team name.
    expect(poll.options).toHaveLength(await db.member.count({ where: { status: "active" } }));
    expect(poll.options.map((option) => option.text)).toEqual(
      [...poll.options.map((option) => option.text)].sort((a, b) => a.localeCompare(b)),
    );
    expect(pollCalls()[0]!.payload.is_anonymous).toBe(false);
  });

  it("/predict posts it early, then points to it", async () => {
    await harness.say(BOB, GROUP_ID, "/predict@pot_test_bot");
    expect(pollCalls()).toHaveLength(1);

    await harness.say(ALICE, GROUP_ID, "/predict");
    await harness.tick(before(24));
    expect(pollCalls()).toHaveLength(1);
    const { pollMessageId } = await gw10();
    expect(lastTo(GROUP_ID)?.text).toBe("Here's the GW10 poll. Vote before the deadline.");
    expect(lastTo(GROUP_ID)?.reply_parameters).toMatchObject({ message_id: pollMessageId });
  });

  it("/predict is for the group, while a gameweek is open", async () => {
    await harness.say(BOB, BOB.id, "/predict");
    expect(lastTo(BOB.id)?.text).toContain("Predictions happen in the group");

    await db.gameweek.updateMany({ data: { status: "locked" } });
    await harness.say(BOB, GROUP_ID, "/predict");
    expect(lastTo(GROUP_ID)?.text).toContain("no gameweek open for predictions");
    expect(pollCalls()).toEqual([]);
  });

  it("after a deadline, /predict opens the next gameweek's poll", async () => {
    clock.now = DEADLINE;
    await harness.say(BOB, GROUP_ID, "/predict");

    expect(pollCalls()[0]?.payload.question).toBe("Who wins GW11? Bragging rights only.");
  });

  it("if Telegram fails, it goes up on a later tick", async () => {
    harness.blockedChats.add(GROUP_ID);
    await harness.tick(before(24));
    expect((await gw10()).pollId).toBeNull();

    harness.blockedChats.clear();
    await harness.tick(before(23));
    expect((await gw10()).pollId).not.toBeNull();
  });

  it("closes at the deadline, once", async () => {
    await harness.tick(before(24));
    await harness.tick(DEADLINE);
    await harness.tick(new Date(DEADLINE.getTime() + HOUR));

    const stops = calls.filter((call) => call.method === "stopPoll");
    expect(stops).toHaveLength(1);
    expect(stops[0]?.payload).toMatchObject({ chat_id: GROUP_ID, message_id: (await gw10()).pollMessageId });
  });
});

describe("votes", () => {
  beforeEach(() => harness.tick(before(24)));

  it("are stored, changed and taken back", async () => {
    await vote(ALICE, KINGS);
    expect((await votes()).map((row) => [row.member.fplEntryId, row.picked.fplEntryId])).toEqual([[JAZZ, KINGS]]);

    await vote(ALICE, NAT_FC);
    expect((await votes()).map((row) => row.picked.fplEntryId)).toEqual([NAT_FC]);

    await vote(ALICE, null);
    expect(await votes()).toEqual([]);
  });

  it("only count from someone who claimed a team, before the deadline", async () => {
    await vote(OWNER, KINGS);
    expect(await votes()).toEqual([]);

    clock.now = DEADLINE;
    await vote(BOB, KINGS);
    expect(await votes()).toEqual([]);
  });
});

describe("after the results", () => {
  beforeEach(async () => {
    await harness.tick(before(24));
    await vote(ALICE, JAZZ);
    await vote(BOB, KINGS);
    await payEveryone();
  });

  it("the results post says who called it", async () => {
    await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });

    const results = posts.find((post) => post.text.includes("GW10 results are final"));
    expect(results?.text).toContain("🔮 Called it: Yabets M");
  });

  it("says so when nobody saw it coming", async () => {
    await settleGw10({ [NAT_FC]: { points: 100 }, [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });

    const results = posts.find((post) => post.text.includes("GW10 results are final"));
    expect(results?.text).toContain("🔮 Nobody saw that coming.");
  });

  it("/me and the ledger show accuracy, and follow a corrected result", async () => {
    await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });

    await harness.say(BOB, BOB.id, "/me");
    expect(lastTo(BOB.id)?.text).toContain("Predictions: 0 right out of 1.");
    const league = await db.league.findFirstOrThrow();
    expect((await leagueLedger(db, league.id)).predictions).toEqual([
      { memberId: (await memberOf(JAZZ)).id, manager: "Yabets M", predicted: 1, right: 1 },
      { memberId: (await memberOf(KINGS)).id, manager: "KB Gselassie", predicted: 1, right: 0 },
    ]);

    await harness.say(OWNER, GROUP_ID, `/override winner 10 ${KINGS}`);
    await harness.say(BOB, BOB.id, "/me");
    expect(lastTo(BOB.id)?.text).toContain("Predictions: 1 right out of 1.");
  });
});
