import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, world, posts, calls, blockedChats } = harness;

const KIBROM = { id: 200, first_name: "Kibrom", language_code: "en" };
const JAZZ = 7789411;
const KINGS = 4161001;
const NAT_FC = 3052815;
const HOUR = 60 * 60 * 1000;
const DEADLINE = new Date("2026-11-06T18:30:00Z");
const AFTER_MATCHES = new Date("2026-11-10T12:00:00Z");

const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const groupTexts = () =>
  calls
    .filter((call) => call.method === "sendMessage" && call.payload.chat_id === GROUP_ID)
    .map((call) => String(call.payload.text));
const edits = () => calls.filter((call) => call.method === "editMessageText").map((call) => String(call.payload.text));
const cardsTo = (chatId: number) =>
  posts.filter((post) => post.chatId === BigInt(chatId) && post.text.includes("Please send by Telebirr"));

async function settleGw10(scores: Record<number, { points: number }>) {
  const due = await db.obligation.findMany({ where: { gameweek: { fplEventId: 10 }, status: "due" } });
  for (const obligation of due) {
    await db.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });
  }
  await harness.tick(DEADLINE);
  world.finished = { 10: {} };
  world.scores = { 10: scores };
  world.eventStatus = {
    status: [{ bonus_added: true, date: "2026-11-09", event: 10, points: "r" }],
    leagues: "Updated",
  };
  await harness.tick(AFTER_MATCHES);
  await harness.tick(new Date(AFTER_MATCHES.getTime() + HOUR));
  return db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } });
}
const reply = (person: { id: number; first_name: string }) => ({
  reply_to_message: {
    message_id: 5,
    date: 0,
    chat: { id: GROUP_ID, type: "supergroup" },
    from: { is_bot: false, ...person },
  },
});

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  posts.length = 0;
  calls.length = 0;
  blockedChats.clear();
  harness.clock.now = AFTER_MATCHES;

  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  await harness.say(OWNER, GROUP_ID, "/coordinator", reply(KIBROM));
  await harness.tick(new Date("2026-11-01T12:00:00Z"));
  posts.length = 0;
  calls.length = 0;
});
afterAll(() => db.$disconnect());

describe("after results", () => {
  it("the coordinator gets a card saying who to pay, with a button", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });

    const [card] = cardsTo(KIBROM.id);
    expect(card?.text).toContain("Yabets M (Jazz, team ID 7789411): 1000 birr");
    const jazz = await memberOf(JAZZ);
    expect(JSON.stringify(card?.replyMarkup)).toContain(`payout:${gameweek.id}:${jazz.id}`);
  });

  it("is sent once, however many ticks run", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.tick(new Date(AFTER_MATCHES.getTime() + 2 * HOUR));

    expect(cardsTo(KIBROM.id)).toHaveLength(1);
  });

  it("goes to the owner when there's no coordinator", async () => {
    await db.league.updateMany({ data: { coordinatorUserId: null } });
    await settleGw10({ [JAZZ]: { points: 90 } });

    expect(cardsTo(OWNER.id)).toHaveLength(1);
  });

  it("goes to the group if the coordinator never pressed Start", async () => {
    blockedChats.add(KIBROM.id);
    await settleGw10({ [JAZZ]: { points: 90 } });

    expect(cardsTo(GROUP_ID)).toHaveLength(1);
  });

  it("tied winners each get a line and a button", async () => {
    await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 90 } });

    const [card] = cardsTo(KIBROM.id);
    expect(card?.text).toContain("Yabets M (Jazz, team ID 7789411): 500 birr");
    expect(card?.text).toContain("KB Gselassie (kings, team ID 4161001): 500 birr");
  });

  it("sends no card when nobody won", async () => {
    await harness.tick(DEADLINE);
    world.finished = { 10: {} };
    world.scores = { 10: {} };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    await db.obligation.updateMany({ data: { status: "waived" } });
    await harness.tick(AFTER_MATCHES);
    await harness.tick(new Date(AFTER_MATCHES.getTime() + HOUR));

    expect(cardsTo(KIBROM.id)).toEqual([]);
  });
});

describe("tapping Paid", () => {
  it("records the payout, tells the group, logs it and closes the card", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 } });
    const jazz = await memberOf(JAZZ);
    await harness.tap(KIBROM, KIBROM.id, `payout:${gameweek.id}:${jazz.id}`);

    const payout = await db.payout.findFirstOrThrow();
    expect(payout).toMatchObject({ memberId: jazz.id, amount: 1000, txnId: null });
    expect(groupTexts()).toContain("Pot delivered: Yabets M received 1000 birr for GW10.");
    expect(await db.auditLog.count({ where: { action: "payout.record", entityId: payout.id } })).toBe(1);
    expect((await db.result.findFirstOrThrow()).paidOutAt).toEqual(AFTER_MATCHES);
    expect(edits().at(-1)).toContain("every payout is recorded");
  });

  it("a double tap records and announces once", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 } });
    const jazz = await memberOf(JAZZ);
    await harness.tap(KIBROM, KIBROM.id, `payout:${gameweek.id}:${jazz.id}`);
    await harness.tap(KIBROM, KIBROM.id, `payout:${gameweek.id}:${jazz.id}`);

    expect(await db.payout.count()).toBe(1);
    expect(groupTexts().filter((text) => text.includes("Pot delivered"))).toHaveLength(1);
  });

  it("with tied winners, the card keeps the other one until both are paid", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 90 } });
    const [jazz, kings] = [await memberOf(JAZZ), await memberOf(KINGS)];

    await harness.tap(KIBROM, KIBROM.id, `payout:${gameweek.id}:${jazz.id}`);
    expect(edits().at(-1)).toContain("KB Gselassie");
    expect(edits().at(-1)).not.toContain("Yabets M");
    expect((await db.result.findFirstOrThrow()).paidOutAt).toBeNull();

    await harness.tap(KIBROM, KIBROM.id, `payout:${gameweek.id}:${kings.id}`);
    expect(edits().at(-1)).toContain("every payout is recorded");
    expect((await db.result.findFirstOrThrow()).paidOutAt).toEqual(AFTER_MATCHES);
  });

  it("only the owner or coordinator can tap", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 } });
    const jazz = await memberOf(JAZZ);
    await harness.tap(ALICE, GROUP_ID, `payout:${gameweek.id}:${jazz.id}`);

    expect(await db.payout.count()).toBe(0);
  });
});

describe("/paidout", () => {
  it("records a transaction number, in capitals, and tells the group", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${JAZZ} djv9abc123`);

    expect((await db.payout.findFirstOrThrow()).txnId).toBe("DJV9ABC123");
    expect(groupTexts()).toContain("Pot delivered: Yabets M received 1000 birr for GW10.");
  });

  it("works without a transaction number", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${JAZZ}`);

    expect(await db.payout.count()).toBe(1);
  });

  it("refuses a number already used by a payment or another payout", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 90 } });
    const obligation = await db.obligation.findFirstOrThrow({ where: { gameweekId: gameweek.id, status: "paid" } });
    await db.payment.create({
      data: { obligationId: obligation.id, txnId: "PAYMENT123", amount: 100, method: "screenshot" },
    });

    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${JAZZ} PAYMENT123`);
    expect(groupTexts().at(-1)).toContain("already been used");
    expect(await db.payout.count()).toBe(0);

    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${JAZZ} PAYOUT1234`);
    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${KINGS} PAYOUT1234`);
    expect(groupTexts().at(-1)).toContain("already been used");
    expect(await db.payout.count()).toBe(1);
  });

  it("refuses someone who isn't owed anything, or twice", async () => {
    await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });

    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${KINGS}`);
    expect(groupTexts().at(-1)).toContain("kings isn't owed a payout");

    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${JAZZ}`);
    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${JAZZ}`);
    expect(groupTexts().at(-1)).toContain("already recorded");
    expect(await db.payout.count()).toBe(1);
  });

  it("refuses a gameweek that hasn't settled, and bad input", async () => {
    await harness.say(KIBROM, GROUP_ID, `/paidout 10 ${JAZZ}`);
    expect(groupTexts().at(-1)).toContain("GW10 hasn't settled");

    for (const command of ["/paidout", "/paidout x y", `/paidout 10 ${JAZZ} a!`]) {
      await harness.say(KIBROM, GROUP_ID, command);
      expect(groupTexts().at(-1)).toContain("Use /paidout");
    }
    await harness.say(KIBROM, GROUP_ID, `/paidout 99 ${JAZZ}`);
    expect(groupTexts().at(-1)).toContain("GW99 isn't part");
    await harness.say(KIBROM, GROUP_ID, "/paidout 10 5");
    expect(groupTexts().at(-1)).toContain("No team with ID 5");
  });

  it("refuses members", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(ALICE, GROUP_ID, `/paidout 10 ${JAZZ}`);

    expect(groupTexts().at(-1)).toContain("Only the league owner or coordinator");
    expect(await db.payout.count()).toBe(0);
  });
});

describe("a correction after results", () => {
  it("before any payout: sends a new card for the new winner", async () => {
    await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    calls.length = 0;
    await harness.say(OWNER, GROUP_ID, `/override winner 10 ${NAT_FC}`);

    const card = calls.find(
      (call) => call.payload.chat_id === KIBROM.id && String(call.payload.text).includes("Please send by Telebirr"),
    );
    expect(card?.payload.text).toContain("Natnael Tessema");
    expect(card?.payload.text).not.toContain("Yabets M");
  });

  it("after a payout: warns, and leaves the recorded payout alone", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    const jazz = await memberOf(JAZZ);
    await harness.tap(KIBROM, KIBROM.id, `payout:${gameweek.id}:${jazz.id}`);
    await harness.say(OWNER, GROUP_ID, `/override score ${KINGS} 10 95`);

    expect(groupTexts().at(-1)).toContain("a payout is already recorded for Yabets M");
    expect(await db.payout.findFirstOrThrow()).toMatchObject({ memberId: jazz.id, amount: 1000 });
  });

  it("no warning when the payout still matches", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    const jazz = await memberOf(JAZZ);
    await harness.tap(KIBROM, KIBROM.id, `payout:${gameweek.id}:${jazz.id}`);
    await harness.say(OWNER, GROUP_ID, `/override score ${KINGS} 10 85`);

    expect(groupTexts().at(-1)).toContain("Corrected result for GW10");
    expect(groupTexts().at(-1)).not.toContain("already recorded");
  });
});

describe("/payout, then a screenshot", () => {
  const paidScreenshot = (overrides = {}) => ({
    isTelebirrReceipt: true,
    successful: true,
    transactionNumber: "PAYOUT0001",
    transactionTo: "Yabets",
    transactionTime: "2026/11/10 15:00:00",
    amount: 1003,
    ...overrides,
  });
  const lastTo = (chatId: number) =>
    calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId).at(-1)?.payload.text;
  const sentPhotos = () => calls.filter((call) => call.method === "sendPhoto");

  beforeEach(() => {
    harness.reader.fails = false;
    harness.reader.reading = paidScreenshot();
    harness.reader.calls = 0;
  });

  it("in private: records it, shows the group the screenshot and confirms", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, KIBROM.id, "/payout");
    expect(lastTo(KIBROM.id)).toContain("send Yabets M 1000 birr on Telebirr");

    await harness.photo(KIBROM, KIBROM.id, { fileId: "proof" });

    const payout = await db.payout.findFirstOrThrow();
    expect(payout).toMatchObject({ amount: 1000, txnId: "PAYOUT0001", paidAt: new Date("2026-11-10T12:00:00.000Z") });
    expect(await db.auditLog.count({ where: { action: "payout.record" } })).toBe(1);
    expect(sentPhotos()[0]?.payload).toMatchObject({
      chat_id: GROUP_ID,
      photo: "proof",
      caption: expect.stringContaining("Pot delivered: Yabets M received 1000 birr for GW10."),
    });
    expect(sentPhotos()[0]?.payload.caption).toContain("Telebirr shows it went to: Yabets");
    expect(lastTo(KIBROM.id)).toContain("payout for GW10 is recorded");
    expect(await db.payoutRequest.count()).toBe(0);
  });

  it("in the group: no mention needed", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, GROUP_ID, "/payout");
    await harness.photo(KIBROM, GROUP_ID);

    expect(await db.payout.count()).toBe(1);
    expect(groupTexts().at(-1)).toContain("Pot delivered: Yabets M");
  });

  it("with tied winners, asks who first, then the next /payout offers only the other", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 90 } });
    const jazz = await memberOf(JAZZ);
    await harness.say(KIBROM, KIBROM.id, "/payout");
    expect(lastTo(KIBROM.id)).toContain("who did you pay");

    await harness.tap(KIBROM, KIBROM.id, `payoutpick:${gameweek.id}:${jazz.id}`);
    expect(edits().at(-1)).toContain("send Yabets M 500 birr");
    harness.reader.reading = paidScreenshot({ amount: 502 });
    await harness.photo(KIBROM, KIBROM.id);
    expect((await db.payout.findFirstOrThrow()).memberId).toBe(jazz.id);

    await harness.say(KIBROM, KIBROM.id, "/payout");
    expect(lastTo(KIBROM.id)).toContain("send KB Gselassie 500 birr");
  });

  it("uses the oldest unpaid gameweek, and says when there's nothing", async () => {
    await harness.say(KIBROM, KIBROM.id, "/payout");
    expect(lastTo(KIBROM.id)).toContain("no payouts waiting");

    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, KIBROM.id, "/payout");
    await harness.photo(KIBROM, KIBROM.id);
    await harness.say(KIBROM, KIBROM.id, "/payout");
    expect(lastTo(KIBROM.id)).toContain("no payouts waiting");
  });

  it.each([
    [{ isTelebirrReceipt: false }, "doesn't look like a Telebirr"],
    [{ successful: false }, "didn't succeed"],
    [{ amount: 500 }, "500 birr, but 1000 birr is due"],
    [{ transactionTime: "2026/11/06 12:00:00" }, "before the GW10 deadline"],
    [{ transactionNumber: null }, "couldn't read that clearly"],
  ])("refuses %j and keeps waiting for a better screenshot", async (overrides, message) => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, KIBROM.id, "/payout");
    harness.reader.reading = paidScreenshot(overrides);
    await harness.photo(KIBROM, KIBROM.id);

    expect(lastTo(KIBROM.id)).toContain(message);
    expect(await db.payout.count()).toBe(0);

    harness.reader.reading = paidScreenshot();
    await harness.photo(KIBROM, KIBROM.id);
    expect(await db.payout.count()).toBe(1);
  });

  it("when the AI is down, points to /paidout and records nothing", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, KIBROM.id, "/payout");
    harness.reader.fails = true;
    await harness.photo(KIBROM, KIBROM.id);

    expect(lastTo(KIBROM.id)).toContain(`/paidout 10 ${JAZZ}`);
    expect(await db.payout.count()).toBe(0);
  });

  it("a transaction number can't be reused", async () => {
    const gameweek = await settleGw10({ [JAZZ]: { points: 90 }, [KINGS]: { points: 90 } });
    const [jazz, kings] = [await memberOf(JAZZ), await memberOf(KINGS)];
    harness.reader.reading = paidScreenshot({ amount: 502 });
    await harness.tap(KIBROM, KIBROM.id, `payoutpick:${gameweek.id}:${jazz.id}`);
    await harness.photo(KIBROM, KIBROM.id);
    await harness.tap(KIBROM, KIBROM.id, `payoutpick:${gameweek.id}:${kings.id}`);
    await harness.photo(KIBROM, KIBROM.id);

    expect(lastTo(KIBROM.id)).toContain("already been used");
    expect(await db.payout.count()).toBe(1);
  });

  it("a photo with no /payout before it, or long after, isn't treated as one", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(KIBROM, KIBROM.id, "/payout");
    harness.clock.now = new Date(AFTER_MATCHES.getTime() + 31 * 60 * 1000);
    await harness.photo(KIBROM, KIBROM.id);

    expect(await db.payout.count()).toBe(0);
    expect(await db.payoutRequest.count()).toBe(0);
  });

  it("only the owner or coordinator can start one, and another person's photo doesn't count", async () => {
    await settleGw10({ [JAZZ]: { points: 90 } });
    await harness.say(ALICE, GROUP_ID, "/payout");
    expect(groupTexts().at(-1)).toContain("Only the league owner or coordinator");
    expect(await db.payoutRequest.count()).toBe(0);

    await harness.say(KIBROM, GROUP_ID, "/payout");
    await harness.photo(ALICE, GROUP_ID);
    expect(await db.payout.count()).toBe(0);
  });
});
