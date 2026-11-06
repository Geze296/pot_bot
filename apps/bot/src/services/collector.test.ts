import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ALICE,
  clearDatabase,
  createHarness,
  fixtureManagers,
  GROUP_ID,
  LEAGUE_ID,
  OWNER,
} from "../testing/harness.js";
import { leagueLedger } from "./ledger.js";

const harness = createHarness({ realSeed: true });
const { db, posts, calls, world, reader } = harness;

// In our league, Kibrom plays as KB Gselassie, team "kings".
const KIBROM = { id: 200, first_name: "Kibrom", username: "kibrom_t", language_code: "en" };
const KINGS = 4161001;
const JAZZ = 7789411;
const NAT_FC = 3052815;
const EPHREM = 11201236;
const CHAMPS = 7792534;

const OPEN = new Date("2026-11-05T12:00:00Z");
const GW10_DEADLINE = new Date("2026-11-06T18:30:00Z");
const AFTER = new Date("2026-11-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const feeOf = (entry: number, gw = 10) =>
  db.obligation.findFirstOrThrow({
    where: { member: { fplEntryId: entry }, gameweek: { fplEventId: gw } },
    include: { payments: true },
  });
const reply = (person: { id: number; first_name: string }) => ({
  reply_to_message: {
    message_id: 5,
    date: 0,
    chat: { id: GROUP_ID, type: "supergroup" },
    from: { is_bot: false, ...person },
  },
});

/** Your league as it is now: 10 managers, since Champ's Team left. */
async function setUp() {
  world.managers = (fixtureManagers() as { entry: number }[]).filter((manager) => manager.entry !== CHAMPS);
  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  const { joinToken } = await db.league.findFirstOrThrow();
  await harness.say(KIBROM, KIBROM.id, `/start join_${joinToken}`);
  await harness.tap(KIBROM, KIBROM.id, `claim:${(await memberOf(KINGS)).id}`);
  await harness.say(ALICE, ALICE.id, `/start join_${joinToken}`);
  await harness.tap(ALICE, ALICE.id, `claim:${(await memberOf(JAZZ)).id}`);
  await harness.say(OWNER, GROUP_ID, "/coordinator", reply(KIBROM));
  await harness.tick(OPEN);
  posts.length = 0;
  calls.length = 0;
}

/** Everyone who owes pays by Telebirr, as real payments. */
async function everyonePays(gw: number) {
  const due = await db.obligation.findMany({ where: { status: "due", gameweek: { fplEventId: gw } } });
  for (const fee of due) {
    await db.obligation.update({ where: { id: fee.id }, data: { status: "paid" } });
    await db.payment.create({
      data: { obligationId: fee.id, amount: fee.amountDue, method: "screenshot", verifyStatus: "verified" },
    });
  }
}

async function finish(gw: number, scores: Record<number, { points: number; cost?: number }>, at = AFTER) {
  world.finished = { ...world.finished, [gw]: {} };
  world.scores = { ...world.scores, [gw]: scores };
  world.eventStatus = { status: [{ bonus_added: true, date: "x", event: gw, points: "r" }], leagues: "Updated" };
  await harness.tick(at);
  await harness.tick(new Date(at.getTime() + HOUR));
}

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  posts.length = 0;
  calls.length = 0;
  reader.calls = 0;
});
afterAll(() => db.$disconnect());

describe("your league's numbers", () => {
  it("10 players: last week's winner and runner-up skip, Kibrom's fee counts, and the pot is 800", async () => {
    await setUp();

    // GW9's winner and runner-up, from FPL.
    expect((await feeOf(JAZZ)).reason).toBe("free_pass");
    expect((await feeOf(EPHREM)).reason).toBe("free_pass");

    await everyonePays(10);
    await harness.tick(GW10_DEADLINE);
    await finish(10, { [NAT_FC]: { points: 90 }, [EPHREM]: { points: 80 } });

    const gw10 = await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } });
    expect(gw10.potAmount).toBe(800);
    expect((await db.result.findFirstOrThrow()).payoutAmount).toBe(800);
    expect(posts.map((post) => post.text).join("\n")).toContain("Natnael Tessema gets 800 birr");
  });

  it("next week, both the winner and runner-up skip", async () => {
    await setUp();
    await everyonePays(10);
    await harness.tick(GW10_DEADLINE);
    await finish(10, { [NAT_FC]: { points: 90 }, [EPHREM]: { points: 80 } });

    expect(await feeOf(NAT_FC, 11)).toMatchObject({ reason: "free_pass", amountDue: 0, status: "paid" });
    expect(await feeOf(EPHREM, 11)).toMatchObject({ reason: "free_pass", amountDue: 0, status: "paid" });
    expect(posts.map((post) => post.text).join("\n")).toContain("Free pass for GW11: Natnael Tessema & Ephrem T");
  });

  it("a tie for 1st gives all three a pass", async () => {
    await setUp();
    await everyonePays(10);
    await harness.tick(GW10_DEADLINE);
    await finish(10, { [NAT_FC]: { points: 90 }, [JAZZ]: { points: 90 }, [EPHREM]: { points: 80 } });

    for (const entry of [NAT_FC, JAZZ, EPHREM]) {
      expect((await feeOf(entry, 11)).reason).toBe("free_pass");
    }
  });
});

describe("Kibrom's fee", () => {
  it("counts as paid without him sending anything, and is in the ledger", async () => {
    await setUp();
    const fee = await feeOf(KINGS);

    expect(fee).toMatchObject({ status: "paid", reason: "entry", amountDue: 100 });
    expect(fee.payments).toHaveLength(1);
    expect(
      (await leagueLedger(db, fee.id && (await db.league.findFirstOrThrow()).id)).members.find(
        (row) => row.team === "kings",
      )?.paidIn,
    ).toBe(100);
  });

  it("he's never reminded, in the group or privately", async () => {
    await setUp();
    for (const hoursBefore of [48, 24, 18, 6, 3, 1]) {
      await harness.tick(new Date(GW10_DEADLINE.getTime() - hoursBefore * HOUR));
    }

    expect(posts.some((post) => post.parseMode === "HTML" && post.text.includes("kibrom_t"))).toBe(false);
    expect(posts.some((post) => post.chatId === BigInt(KIBROM.id))).toBe(false);
    expect(posts.some((post) => post.parseMode === "HTML")).toBe(true);
  });

  it("nothing is posted saying he paid", async () => {
    await setUp();
    await harness.tick(OPEN);

    expect(posts.map((post) => post.text).join("\n")).not.toContain("KB Gselassie paid");
    expect(calls.map((call) => String(call.payload.text)).join("\n")).not.toContain("KB Gselassie paid");
  });

  it("he isn't charged for what's already counted, and it can't be undone by hand", async () => {
    await setUp();
    await harness.say(KIBROM, GROUP_ID, `/markunpaid ${KINGS}`);

    expect((await feeOf(KINGS)).status).toBe("paid");
    expect(await db.payment.count({ where: { obligation: { member: { fplEntryId: KINGS } } } })).toBe(1);
  });

  it("running the job again doesn't add a second one", async () => {
    await setUp();
    await harness.tick(OPEN);
    await harness.tick(OPEN);

    expect((await feeOf(KINGS)).payments).toHaveLength(1);
  });

  it("a screenshot from him costs no AI call", async () => {
    await setUp();
    await harness.photo(KIBROM, KIBROM.id);

    expect(reader.calls).toBe(0);
  });

  it("takes effect for whoever becomes coordinator, and is handed back by the last one", async () => {
    await setUp();
    await harness.say(OWNER, GROUP_ID, "/coordinator", reply(ALICE));
    await harness.tick(OPEN);

    // Alice has a free pass this week, so only Kibrom's fee changes.
    expect(await feeOf(KINGS)).toMatchObject({ status: "due", payments: [] });
    expect((await feeOf(JAZZ)).reason).toBe("free_pass");
  });

  it("applies once a coordinator claims their team", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await harness.tap(OWNER, GROUP_ID, "setup:confirm");
    await harness.say(OWNER, GROUP_ID, "/coordinator", reply(KIBROM));
    await harness.tick(OPEN);
    expect((await feeOf(KINGS)).status).toBe("due");

    const { joinToken } = await db.league.findFirstOrThrow();
    await harness.say(KIBROM, KIBROM.id, `/start join_${joinToken}`);
    await harness.tap(KIBROM, KIBROM.id, `claim:${(await memberOf(KINGS)).id}`);
    await harness.tick(OPEN);

    expect((await feeOf(KINGS)).status).toBe("paid");
  });

  it("a coordinator who doesn't play has no fee to think about", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await harness.tap(OWNER, GROUP_ID, "setup:confirm");
    await harness.say(OWNER, GROUP_ID, "/coordinator", reply({ id: 900, first_name: "NotPlaying" }));
    await harness.tick(OPEN);

    expect(await db.payment.count()).toBe(0);
  });

  it("isn't locked out by the deadline", async () => {
    await setUp();
    await harness.tick(GW10_DEADLINE);

    expect((await feeOf(KINGS)).status).toBe("paid");
  });
});

describe("when Kibrom wins", () => {
  async function kibromWins(
    scores: Record<number, { points: number }> = { [KINGS]: { points: 99 }, [NAT_FC]: { points: 80 } },
  ) {
    await setUp();
    await everyonePays(10);
    await harness.tick(GW10_DEADLINE);
    posts.length = 0;
    await finish(10, scores);
  }

  it("the result says he holds it, with no note about sending money", async () => {
    await kibromWins();
    const results = posts.find((post) => post.text.includes("results are final"))!.text;

    expect(results).toContain("Winner: KB Gselassie");
    expect(results).toContain("KB Gselassie gets 800 birr, and already holds it");
    expect(results).not.toContain("sends this by Telebirr");
  });

  it("there's no payout card and no Pot delivered", async () => {
    await kibromWins();
    const texts = [...posts.map((post) => post.text), ...calls.map((call) => String(call.payload.text))].join("\n");

    expect(texts).not.toContain("Please send by Telebirr");
    expect(texts).not.toContain("Pot delivered");
  });

  it("the ledger still adds up, with his share counted as delivered", async () => {
    await kibromWins();
    const league = await db.league.findFirstOrThrow();
    const kings = (await leagueLedger(db, league.id)).members.find((row) => row.team === "kings");

    expect(kings).toMatchObject({ paidIn: 100, won: 800, received: 800, net: 700 });
    expect((await db.result.findFirstOrThrow()).paidOutAt).not.toBeNull();
  });

  it("/payout has nothing to do", async () => {
    await kibromWins();
    calls.length = 0;
    await harness.say(KIBROM, KIBROM.id, "/payout");

    expect(String(calls.at(-1)?.payload.text)).toContain("no payouts waiting");
  });

  it("his next fee is a free pass, and his counted fee doesn't become credit", async () => {
    await kibromWins();
    const next = await feeOf(KINGS, 11);

    expect(next).toMatchObject({ reason: "free_pass", amountDue: 0, status: "paid", payments: [] });
    expect(await db.obligation.count({ where: { gameweek: { fplEventId: { gt: 12 } } } })).toBe(0);
    const later = await db.payment.count({
      where: {
        obligation: { member: { fplEntryId: KINGS }, gameweek: { fplEventId: { gt: 11 } } },
        verifyReason: null,
      },
    });
    expect(later).toBe(0);
  });

  it("after his free pass, his fee is counted again", async () => {
    await kibromWins();
    await harness.tick(new Date("2026-11-21T11:00:00Z"));
    await harness.tick(new Date("2026-11-21T12:00:00Z"));

    expect(await feeOf(KINGS, 12)).toMatchObject({ status: "paid", reason: "entry", amountDue: 100 });
  });

  it("a shared win only asks the coordinator to send the other winner's share", async () => {
    await kibromWins({ [KINGS]: { points: 99 }, [NAT_FC]: { points: 99 } });
    const card = posts.find((post) => post.text.includes("Please send by Telebirr"))!;

    expect(card.text).toContain("Natnael Tessema");
    expect(card.text).toContain("400 birr");
    expect(card.text).not.toContain("KB Gselassie");
    const results = posts.find((post) => post.text.includes("results are final"))!.text;
    expect(results).toContain("sends this by Telebirr");
    expect((await db.result.findFirstOrThrow()).paidOutAt).toBeNull();
  });

  it("a correction that takes the win from him removes his payout and asks for the new one", async () => {
    await kibromWins();
    calls.length = 0;
    await harness.say(OWNER, GROUP_ID, `/override score ${NAT_FC} 10 120`);

    const kings = await memberOf(KINGS);
    expect(await db.payout.count({ where: { memberId: kings.id } })).toBe(0);
    expect((await db.result.findFirstOrThrow()).paidOutAt).toBeNull();
    const sent = calls.map((call) => String(call.payload.text)).join("\n");
    expect(sent).toContain("Natnael Tessema (Nat FC");
    expect(sent).not.toContain("a payout is already recorded");
  });

  it("if he's named the winner by hand, the same applies", async () => {
    await setUp();
    await everyonePays(10);
    await harness.tick(GW10_DEADLINE);
    posts.length = 0;
    calls.length = 0;
    await harness.say(OWNER, GROUP_ID, `/override winner 10 ${KINGS}`);

    expect((await db.payout.findFirstOrThrow()).memberId).toBe((await memberOf(KINGS)).id);
    expect(calls.map((call) => String(call.payload.text)).join("\n")).not.toContain("Please send by Telebirr");
  });
});
