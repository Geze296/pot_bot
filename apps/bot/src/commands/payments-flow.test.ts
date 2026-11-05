import type { ScreenshotReading } from "@potbot/ai";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, BOB, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, reader, clock, calls, world, posts } = harness;

const KIBROM = { id: 200, first_name: "Kibrom", language_code: "en" };
const MENTION = "paid @pot_test_bot";
const JAZZ = 7789411;
const KINGS = 4161001;
const NAT_FC = 3052815;

const GW10_DEADLINE = new Date("2026-11-06T18:30:00Z");
const HOUR = 60 * 60 * 1000;

let txnCounter = 0;
/** What Gemini reads from a real screenshot. Times are Addis time, which is UTC+3. */
const screenshot = (overrides: Partial<ScreenshotReading> = {}): ScreenshotReading => ({
  isTelebirrReceipt: true,
  successful: true,
  transactionNumber: `DJV${String(++txnCounter).padStart(7, "0")}`,
  transactionTo: "Kibrom",
  transactionTime: "2026/11/05 14:00:00",
  amount: 101,
  ...overrides,
});

const sent = (method: string) => calls.filter((call) => call.method === method);
const textsTo = (chatId: number) =>
  calls
    .filter((call) => call.payload.chat_id === chatId && call.method === "sendMessage")
    .map((call) => String(call.payload.text));
const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const obligationOf = async (entry: number, gw: number) =>
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

beforeEach(async () => {
  await clearDatabase(db);
  calls.length = 0;
  posts.length = 0;
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  Object.assign(reader, { reading: screenshot(), fails: false, calls: 0 });
  clock.now = new Date("2026-11-05T12:00:00Z");
  harness.blockedChats.clear();

  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  await harness.tick(clock.now);
  await harness.say(OWNER, GROUP_ID, "/coordinator", reply(KIBROM));
  await harness.say(OWNER, GROUP_ID, "/settelebirr Kibrom");

  const { joinToken } = await db.league.findFirstOrThrow();
  await harness.say(ALICE, ALICE.id, `/start join_${joinToken}`);
  await harness.tap(ALICE, ALICE.id, `claim:${(await memberOf(JAZZ)).id}`);
  await harness.say(BOB, BOB.id, `/start join_${joinToken}`);
  await harness.tap(BOB, BOB.id, `claim:${(await memberOf(KINGS)).id}`);
  calls.length = 0;
});
afterAll(() => db.$disconnect());

describe("in the group", () => {
  it("a photo that mentions the bot is checked and marks the member paid", async () => {
    await harness.photo(ALICE, GROUP_ID, { caption: MENTION });

    const obligation = await obligationOf(JAZZ, 10);
    expect(obligation.status).toBe("paid");
    expect(obligation.payments[0]).toMatchObject({
      method: "screenshot",
      verifyStatus: "verified",
      receiverMatch: true,
      paidAt: new Date("2026-11-05T11:00:00.000Z"),
    });
    expect(textsTo(GROUP_ID).at(-1)).toContain("Yabets M paid for GW10. The pot is now 100 birr");
    expect(sent("sendPhoto")).toEqual([]);
  });

  it("the pot grows by the fee, not by Telebirr's charged amount", async () => {
    await harness.photo(ALICE, GROUP_ID, { caption: MENTION });
    reader.reading = screenshot({ amount: 102.01 });
    await harness.photo(BOB, GROUP_ID, { caption: MENTION });

    expect(textsTo(GROUP_ID).at(-1)).toContain("The pot is now 200 birr");
    expect((await obligationOf(KINGS, 10)).payments[0]?.amount).toBe(100);
  });

  it("a photo without a mention never reaches the AI", async () => {
    await harness.photo(ALICE, GROUP_ID);

    expect(reader.calls).toBe(0);
    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
  });

  it("nudges an unpaid member once per gameweek, in case it was a payment", async () => {
    await harness.photo(ALICE, GROUP_ID);
    await harness.photo(ALICE, GROUP_ID);

    const nudges = textsTo(GROUP_ID).filter((text) => text.includes("reply to the photo and mention me"));
    expect(nudges).toHaveLength(1);
  });

  it("doesn't nudge someone who has paid, or someone who isn't a member", async () => {
    await harness.photo(ALICE, GROUP_ID, { caption: MENTION });
    calls.length = 0;
    await harness.photo(ALICE, GROUP_ID);
    await harness.photo(KIBROM, GROUP_ID);

    expect(textsTo(GROUP_ID)).toEqual([]);
  });

  it("mentioning the bot in a reply checks the photo, and credits whoever sent it", async () => {
    await harness.say(BOB, GROUP_ID, "@pot_test_bot this one", {
      entities: [{ type: "mention", offset: 0, length: "@pot_test_bot".length }],
      reply_to_message: {
        message_id: 7,
        date: 0,
        chat: { id: GROUP_ID, type: "supergroup" },
        from: { is_bot: false, ...ALICE },
        photo: [{ file_id: "f1", file_unique_id: "u1", width: 1, height: 1 }],
      },
    });

    expect(reader.calls).toBe(1);
    expect((await obligationOf(JAZZ, 10)).status).toBe("paid");
    expect((await obligationOf(KINGS, 10)).status).toBe("due");
  });

  it("someone with no team is told how to claim one, without an AI call", async () => {
    await harness.photo(KIBROM, GROUP_ID, { caption: MENTION });

    expect(reader.calls).toBe(0);
    expect(textsTo(GROUP_ID).at(-1)).toContain("claim link");
  });
});

describe("in private chat", () => {
  it("every photo is checked, and the group is told and shown the screenshot", async () => {
    await harness.photo(ALICE, ALICE.id, { fileId: "alice-shot" });

    expect((await obligationOf(JAZZ, 10)).status).toBe("paid");
    expect(textsTo(ALICE.id).at(-1)).toContain("you're paid for GW10");
    expect(sent("sendPhoto")[0]?.payload).toMatchObject({
      chat_id: GROUP_ID,
      photo: "alice-shot",
      caption: expect.stringContaining("Yabets M paid for GW10"),
    });
  });

  it("someone with no team is told how to claim one", async () => {
    await harness.photo(KIBROM, KIBROM.id);

    expect(textsTo(KIBROM.id).at(-1)).toContain("claim link");
    expect(reader.calls).toBe(0);
  });
});

describe("checks", () => {
  const privatePhoto = async () => {
    await harness.photo(ALICE, ALICE.id);
    return textsTo(ALICE.id).at(-1);
  };

  it("an image that isn't a receipt isn't considered", async () => {
    reader.reading = screenshot({ isTelebirrReceipt: false });

    expect(await privatePhoto()).toContain("doesn't look like a Telebirr");
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects a payment to someone else, with the reason", async () => {
    reader.reading = screenshot({ transactionTo: "Abel" });

    expect(await privatePhoto()).toContain("Payments go to Kibrom");
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects a failed transaction", async () => {
    reader.reading = screenshot({ successful: false });

    expect(await privatePhoto()).toContain("didn't succeed");
    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
  });

  it("rejects a short amount", async () => {
    reader.reading = screenshot({ amount: 50 });

    expect(await privatePhoto()).toContain("50 birr, but 100 birr is due");
    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
  });

  it("a transaction number can't be used twice, by anyone (hard rule 6)", async () => {
    const shot = screenshot();
    reader.reading = shot;
    await harness.photo(ALICE, ALICE.id);
    reader.reading = { ...shot, transactionNumber: shot.transactionNumber!.toLowerCase() };
    await harness.photo(BOB, BOB.id);

    expect(textsTo(BOB.id).at(-1)).toContain("already been used");
    expect((await obligationOf(KINGS, 10)).status).toBe("due");
    expect(await db.payment.count()).toBe(1);
  });

  it("spends no AI call on someone already paid", async () => {
    await harness.photo(ALICE, ALICE.id);
    reader.calls = 0;
    await harness.photo(ALICE, ALICE.id);

    expect(reader.calls).toBe(0);
    expect(textsTo(ALICE.id).at(-1)).toContain("already sorted for GW10");
  });

  it("spends no AI call on an image it has already read", async () => {
    reader.reading = screenshot({ isTelebirrReceipt: false });
    await harness.photo(ALICE, ALICE.id, { fileId: "same" });
    reader.calls = 0;
    await harness.photo(ALICE, ALICE.id, { fileId: "same" });

    expect(reader.calls).toBe(0);
    expect(textsTo(ALICE.id).at(-1)).toContain("already checked that image");
  });

  it("a free pass holder has nothing to pay", async () => {
    const ephrem = await memberOf(11201236);
    await db.member.update({
      where: { id: ephrem.id },
      data: { userId: (await db.user.findFirstOrThrow({ where: { telegramId: BigInt(KIBROM.id) } })).id },
    });
    await harness.photo(KIBROM, KIBROM.id);

    expect(reader.calls).toBe(0);
    expect(textsTo(KIBROM.id).at(-1)).toContain("already sorted for GW10");
  });
});

describe("timing", () => {
  it("a screenshot dated after the deadline is refused for this gameweek and counts for the next", async () => {
    await harness.tick(GW10_DEADLINE);
    clock.now = new Date(GW10_DEADLINE.getTime() + HOUR);
    reader.reading = screenshot({ transactionTime: "2026/11/06 22:30:00" });

    await harness.photo(ALICE, ALICE.id);

    expect((await obligationOf(JAZZ, 10)).status).toBe("waived");
    expect((await obligationOf(JAZZ, 11)).status).toBe("paid");
    expect(textsTo(ALICE.id).join("\n")).toContain("doesn't count for GW10. It counts for GW11");
  });

  it("a screenshot dated before the deadline but sent after it still counts, until settling", async () => {
    await harness.tick(GW10_DEADLINE);
    clock.now = new Date(GW10_DEADLINE.getTime() + HOUR);
    reader.reading = screenshot({ transactionTime: "2026/11/06 21:00:00" });

    await harness.photo(ALICE, ALICE.id);

    expect((await obligationOf(JAZZ, 10)).status).toBe("paid");
  });

  it("an old screenshot, from before any window, goes to the coordinator, with its time in Addis time", async () => {
    reader.reading = screenshot({ transactionTime: "2026/10/31 11:04:01" });

    await harness.photo(ALICE, ALICE.id);

    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
    const review = sent("sendPhoto")[0]?.payload;
    expect(review?.chat_id).toBe(KIBROM.id);
    expect(review?.caption).toContain("outside any payment window");
    expect(review?.caption).toContain("Sat 31 Oct, 11:04");
  });

  it("a second payment for a covered gameweek moves on as credit", async () => {
    await harness.photo(ALICE, ALICE.id);
    await harness.tick(GW10_DEADLINE);
    clock.now = new Date(GW10_DEADLINE.getTime() + HOUR);

    // Dated inside GW10's window, but GW10 is paid and locked, so it goes to the open GW11.
    reader.reading = screenshot({ transactionTime: "2026/11/06 20:00:00" });
    await harness.photo(ALICE, ALICE.id);

    expect((await obligationOf(JAZZ, 11)).status).toBe("paid");
  });
});

describe("P3: coordinator review", () => {
  async function submitForReview() {
    reader.fails = true;
    await harness.photo(ALICE, ALICE.id, { fileId: "unread" });
    return db.payment.findFirstOrThrow();
  }
  const card = { photo: [{ file_id: "unread", file_unique_id: "u", width: 1, height: 1 }] };

  it("when Gemini fails, nothing is rejected and the coordinator gets the screenshot with buttons (hard rule 5)", async () => {
    const payment = await submitForReview();

    expect(payment).toMatchObject({ verifyStatus: "needs_review", verifyReason: "ai_unavailable" });
    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
    expect(textsTo(ALICE.id).at(-1)).toContain("sent it to the coordinator");

    const review = sent("sendPhoto")[0]?.payload;
    expect(review).toMatchObject({ chat_id: KIBROM.id, photo: "unread" });
    expect(JSON.stringify(review?.reply_markup)).toContain(`pay:approve:${payment.id}`);
    expect(JSON.stringify(review?.reply_markup)).toContain(`pay:reject:${payment.id}`);
  });

  it("a missing field goes to review, keeping what could be read", async () => {
    reader.reading = screenshot({ transactionTo: null, transactionNumber: "DJVMISSING1" });
    await harness.photo(ALICE, ALICE.id);

    const payment = await db.payment.findFirstOrThrow();
    expect(payment).toMatchObject({ verifyStatus: "needs_review", verifyReason: "unreadable", txnId: "DJVMISSING1" });
  });

  it("with no receiver name set, screenshots go to review", async () => {
    await db.league.updateMany({ data: { coordinatorTelebirrName: null } });
    await harness.photo(ALICE, ALICE.id);

    expect(await db.payment.findFirstOrThrow()).toMatchObject({ verifyReason: "receiver_not_set" });
  });

  it("approving marks them paid, logs it, tells the member and shows the group", async () => {
    const payment = await submitForReview();
    calls.length = 0;
    await harness.tap(KIBROM, KIBROM.id, `pay:approve:${payment.id}`, card);

    expect((await obligationOf(JAZZ, 10)).status).toBe("paid");
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ verifyStatus: "verified" });
    expect(await db.auditLog.count({ where: { action: "payment.approve", entityId: payment.id } })).toBe(1);
    expect(textsTo(ALICE.id).at(-1)).toContain("approved your payment for GW10");
    expect(sent("sendPhoto")[0]?.payload).toMatchObject({
      chat_id: GROUP_ID,
      photo: "unread",
      caption: expect.stringContaining("Yabets M paid for GW10. The pot is now 100 birr"),
    });
  });

  it("rejecting leaves them unpaid, logs it and tells the member, with nothing in the group", async () => {
    const payment = await submitForReview();
    calls.length = 0;
    await harness.tap(KIBROM, KIBROM.id, `pay:reject:${payment.id}`, card);

    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
    expect(await db.auditLog.count({ where: { action: "payment.reject" } })).toBe(1);
    expect(textsTo(ALICE.id).at(-1)).toContain("rejected your payment");
    expect(sent("sendPhoto")).toEqual([]);
    expect(textsTo(GROUP_ID)).toEqual([]);
  });

  it("only the owner or coordinator can decide", async () => {
    const payment = await submitForReview();
    await harness.tap(BOB, BOB.id, `pay:approve:${payment.id}`, card);

    expect(await db.payment.findFirstOrThrow()).toMatchObject({ verifyStatus: "needs_review" });
  });

  it("a double tap decides once", async () => {
    const payment = await submitForReview();
    await harness.tap(KIBROM, KIBROM.id, `pay:approve:${payment.id}`, card);
    calls.length = 0;
    await harness.tap(KIBROM, KIBROM.id, `pay:reject:${payment.id}`, card);

    expect(await db.payment.findFirstOrThrow()).toMatchObject({ verifyStatus: "verified" });
    expect(sent("sendPhoto")).toEqual([]);
  });

  it("if the coordinator never pressed Start, the review appears in the group instead", async () => {
    harness.blockedChats.add(KIBROM.id);
    const payment = await submitForReview();

    expect(textsTo(GROUP_ID).at(-1)).toContain("until they press Start");
    const review = sent("sendPhoto")[0]?.payload;
    expect(review?.chat_id).toBe(GROUP_ID);

    calls.length = 0;
    await harness.tap(KIBROM, GROUP_ID, `pay:approve:${payment.id}`, card);
    expect((await obligationOf(JAZZ, 10)).status).toBe("paid");
    expect(textsTo(GROUP_ID).at(-1)).toContain("Yabets M paid for GW10");
    expect(sent("sendPhoto")).toEqual([]);
  });

  it("settling waits for the review, and an approved payment counts", async () => {
    const payment = await submitForReview();
    reader.fails = false;
    await harness.tick(GW10_DEADLINE);

    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } } };
    world.eventStatus = {
      status: [{ bonus_added: true, date: "2026-11-09", event: 10, points: "r" }],
      leagues: "Updated",
    };
    const after = new Date("2026-11-10T12:00:00Z");
    await harness.tick(after);
    await harness.tick(new Date(after.getTime() + HOUR));
    expect(await db.result.count()).toBe(0);

    await harness.tap(KIBROM, KIBROM.id, `pay:approve:${payment.id}`, card);
    await harness.tick(new Date(after.getTime() + 2 * HOUR));

    const result = await db.result.findFirstOrThrow();
    expect(result.winnerMemberIds).toEqual([(await memberOf(JAZZ)).id]);
    expect(result.payoutAmount).toBe(100);
  });

  it("the daily AI cap sends screenshots to review rather than losing them", async () => {
    const league = await db.league.findFirstOrThrow();
    await db.messageLog.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        leagueId: league.id,
        dedupeKey: `read:old${index}`,
        kind: "screenshot_read",
        sentAt: clock.now,
      })),
    });
    await harness.photo(ALICE, ALICE.id);

    expect(reader.calls).toBe(0);
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ verifyStatus: "needs_review" });
  });
});

describe("coordinator commands", () => {
  const groupTexts = () => textsTo(GROUP_ID);

  it("/settelebirr sets the name to match, and is logged", async () => {
    calls.length = 0;
    await harness.say(KIBROM, GROUP_ID, "/settelebirr Kibrom Tesfaye");

    expect((await db.league.findFirstOrThrow()).coordinatorTelebirrName).toBe("Kibrom Tesfaye");
    expect(await db.auditLog.count({ where: { action: "telebirr.set_receiver" } })).toBe(2);
    expect(groupTexts().at(-1)).toContain("Payments must now go to Kibrom Tesfaye");
  });

  it("/markpaid records cash for an unclaimed team, and is logged", async () => {
    await harness.say(KIBROM, GROUP_ID, `/markpaid ${NAT_FC}`);

    const obligation = await obligationOf(NAT_FC, 10);
    expect(obligation.status).toBe("paid");
    expect(obligation.payments[0]).toMatchObject({
      method: "manual",
      txnId: null,
      verifyStatus: "verified",
      amount: 100,
    });
    expect(await db.auditLog.count({ where: { action: "payment.mark_paid" } })).toBe(1);
    expect(groupTexts().at(-1)).toContain("Nat FC is marked paid for GW10");

    await harness.say(KIBROM, GROUP_ID, `/markpaid ${NAT_FC}`);
    expect(groupTexts().at(-1)).toContain("already sorted");
    expect(await db.payment.count()).toBe(1);
  });

  it("/markunpaid undoes a screenshot that turned out to be fake, and its number stays used", async () => {
    const shot = screenshot();
    reader.reading = shot;
    await harness.photo(ALICE, ALICE.id);
    await harness.say(KIBROM, GROUP_ID, `/markunpaid ${JAZZ}`);

    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
    expect(await db.auditLog.count({ where: { action: "payment.mark_unpaid" } })).toBe(1);

    await harness.photo(ALICE, ALICE.id);
    expect(textsTo(ALICE.id).at(-1)).toContain("already been used");
    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
  });

  it("/markunpaid refuses a free pass, and an unpaid team", async () => {
    await harness.say(KIBROM, GROUP_ID, "/markunpaid 11201236");
    expect(groupTexts().at(-1)).toContain("no payment to undo");
    await harness.say(KIBROM, GROUP_ID, `/markunpaid ${JAZZ}`);
    expect(groupTexts().at(-1)).toContain("no payment to undo");
  });

  it("members can't use any of them", async () => {
    calls.length = 0;
    for (const command of ["/settelebirr Me", `/markpaid ${JAZZ}`, `/markunpaid ${JAZZ}`]) {
      await harness.say(ALICE, GROUP_ID, command);
    }

    expect(groupTexts()).toEqual(Array(3).fill(expect.stringContaining("Only the league owner or coordinator")));
    expect((await obligationOf(JAZZ, 10)).status).toBe("due");
  });

  it("/paid explains how to pay now", async () => {
    await harness.say(ALICE, ALICE.id, "/paid DJV9IHX0G5");

    expect(textsTo(ALICE.id).at(-1)).toContain("Send me your Telebirr screenshot");
    expect(await db.payment.count()).toBe(0);
  });
});
