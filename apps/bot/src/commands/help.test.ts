import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, calls } = harness;

const JAZZ = 7789411;
const sentTo = (chatId: number) =>
  calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId);

async function setUp() {
  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  const { joinToken } = await db.league.findFirstOrThrow();
  const jazz = await db.member.findFirstOrThrow({ where: { fplEntryId: JAZZ } });
  await harness.say(ALICE, ALICE.id, `/start join_${joinToken}`);
  await harness.tap(ALICE, ALICE.id, `claim:${jazz.id}`);
  calls.length = 0;
}

beforeEach(async () => {
  await clearDatabase(db);
  calls.length = 0;
});
afterAll(() => db.$disconnect());

describe("group replies", () => {
  it("are never deleted", async () => {
    await setUp();
    await harness.say(ALICE, GROUP_ID, "/help");
    await harness.say(ALICE, GROUP_ID, "/status");

    expect(sentTo(GROUP_ID)).toHaveLength(2);
    expect(calls.some((call) => call.method === "deleteMessage")).toBe(false);
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
