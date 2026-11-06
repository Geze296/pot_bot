import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, deletions, calls, reader } = harness;

const JAZZ = 7789411;
const sentTo = (chatId: number) =>
  calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId);

async function setUp() {
  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  await harness.tick(harness.clock.now);
  await harness.say(OWNER, GROUP_ID, "/settelebirr Kibrom");
  const { joinToken } = await db.league.findFirstOrThrow();
  const jazz = await db.member.findFirstOrThrow({ where: { fplEntryId: JAZZ } });
  await harness.say(ALICE, ALICE.id, `/start join_${joinToken}`);
  await harness.tap(ALICE, ALICE.id, `claim:${jazz.id}`);
  deletions.length = 0;
  calls.length = 0;
}

beforeEach(async () => {
  await clearDatabase(db);
  deletions.length = 0;
  calls.length = 0;
  harness.deletionsFail.value = false;
  reader.fails = false;
  reader.reading = {
    isTelebirrReceipt: true,
    successful: true,
    transactionNumber: `DJVAUTO${Date.now() % 100000}`,
    transactionTo: "Kibrom",
    transactionTime: "2026/11/05 14:00:00",
    amount: 101,
  };
});
afterAll(() => db.$disconnect());

describe("group replies are deleted later", () => {
  it.each(["/help", "/status", "/table", "/rules"])("%s", async (command) => {
    await setUp();
    await harness.say(ALICE, GROUP_ID, command);

    expect(deletions).toHaveLength(1);
    expect(deletions[0]?.chatId).toBe(GROUP_ID);
    expect(deletions[0]?.messageId).toEqual(expect.any(Number));
  });

  it("errors, like a refused command", async () => {
    await setUp();
    await harness.say(ALICE, GROUP_ID, "/setrule entryFee 5");

    expect(deletions).toHaveLength(1);
  });

  it("the nudge about mentioning the bot", async () => {
    await setUp();
    await harness.photo(ALICE, GROUP_ID);

    expect(sentTo(GROUP_ID)[0]?.payload.text).toContain("mention me");
    expect(deletions).toHaveLength(1);
  });

  it("a rejected screenshot's explanation", async () => {
    await setUp();
    reader.reading = { ...reader.reading!, transactionTo: "Abel" };
    await harness.photo(ALICE, GROUP_ID, { caption: "paid @pot_test_bot" });

    expect(sentTo(GROUP_ID).at(-1)?.payload.text).toContain("Payments go to Kibrom");
    expect(deletions).toHaveLength(1);
  });

  it("a failure to schedule doesn't lose the reply", async () => {
    await setUp();
    harness.deletionsFail.value = true;
    await harness.say(ALICE, GROUP_ID, "/help");

    expect(sentTo(GROUP_ID)).toHaveLength(1);
  });
});

describe("what stays", () => {
  it("private replies", async () => {
    await harness.say(ALICE, ALICE.id, "/help");

    expect(sentTo(ALICE.id)).toHaveLength(1);
    expect(deletions).toEqual([]);
  });

  it("the league confirmation and the claim button", async () => {
    await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
    await harness.tap(OWNER, GROUP_ID, "setup:confirm");

    expect(JSON.stringify(sentTo(GROUP_ID).at(-1)?.payload.reply_markup)).toContain("start=join_");
    expect(deletions).toEqual([]);
  });

  it("a payment announcement", async () => {
    await setUp();
    await harness.photo(ALICE, GROUP_ID, { caption: "paid @pot_test_bot" });

    expect(sentTo(GROUP_ID).at(-1)?.payload.text).toContain("Yabets M paid for GW10");
    expect(deletions).toEqual([]);
  });

  it("a corrected result", async () => {
    await setUp();
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    deletions.length = 0;
    await harness.say(OWNER, GROUP_ID, `/override winner 10 ${JAZZ}`);

    expect(sentTo(GROUP_ID).at(-1)?.payload.text).toContain("Corrected result for GW10");
    expect(deletions).toEqual([]);
  });

  it("scheduled posts", async () => {
    await setUp();
    await harness.tick(new Date("2026-11-06T17:30:00Z"));
    await harness.tick(new Date("2026-11-06T18:30:00Z"));

    expect(harness.posts.length).toBeGreaterThan(0);
    expect(deletions).toEqual([]);
  });
});

describe("/admin", () => {
  const COMMANDS = [
    "/payout",
    "/paidout",
    "/settelebirr",
    "/markpaid",
    "/markunpaid",
    "/override",
    "/setup",
    "/coordinator",
    "/rules",
    "/setrule",
    "/link",
    "/unlink",
  ];

  it("gives the owner every command, in the group and in private", async () => {
    await setUp();
    for (const chat of [GROUP_ID, OWNER.id]) {
      calls.length = 0;
      await harness.say(OWNER, chat, "/admin");
      for (const command of COMMANDS) expect(String(sentTo(chat)[0]?.payload.text)).toContain(command);
    }
  });

  it("refuses members", async () => {
    await setUp();
    for (const chat of [GROUP_ID, ALICE.id]) {
      calls.length = 0;
      await harness.say(ALICE, chat, "/admin");
      expect(String(sentTo(chat)[0]?.payload.text)).toContain("Only the league owner or coordinator");
    }
  });
});

describe("/help", () => {
  it("explains what to do and the member commands, in the group and in private", async () => {
    for (const chat of [GROUP_ID, ALICE.id]) {
      calls.length = 0;
      await harness.say(ALICE, chat, "/help");
      const text = String(sentTo(chat)[0]?.payload.text);

      expect(text).toContain("@pot_test_bot");
      for (const expected of ["Claim my team", "screenshot", "/status", "/table", "/help", "/admin", "/setup"]) {
        expect(text).toContain(expected);
      }
      expect(text).toContain("never holds or sends money");
      expect(text).not.toContain("/markpaid");
    }
  });

  it("works with no league set up", async () => {
    await harness.say(ALICE, GROUP_ID, "/help");

    expect(sentTo(GROUP_ID)[0]?.payload.text).toContain("How Pot Bot works");
  });
});
