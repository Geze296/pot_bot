import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, BOB, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, posts, calls, world } = harness;

const DEADLINE = new Date("2026-11-06T18:30:00Z");
const MINUTE = 60 * 1000;
const before = (minutes: number) => new Date(DEADLINE.getTime() - minutes * MINUTE);
const TWO_DAYS = 48 * 60;
const JAZZ = 7789411;
const KINGS = 4161001;

const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const groupPosts = () => posts.filter((post) => post.chatId === BigInt(GROUP_ID));
const dmsTo = (id: number) => posts.filter((post) => post.chatId === BigInt(id));
const reminders = () => groupPosts().filter((post) => post.parseMode === "HTML");

async function pay(entry: number, gw = 10) {
  const obligation = await db.obligation.findFirstOrThrow({
    where: { member: { fplEntryId: entry }, gameweek: { fplEventId: gw } },
  });
  await db.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });
}

async function payAllExcept(...entries: number[]) {
  const due = await db.obligation.findMany({
    where: { status: "due", gameweek: { fplEventId: 10 }, member: { fplEntryId: { notIn: entries } } },
    select: { id: true },
  });
  await db.obligation.updateMany({ where: { id: { in: due.map((item) => item.id) } }, data: { status: "paid" } });
}

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  harness.blockedChats.clear();
  harness.telegram.down = false;

  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");

  const { joinToken } = await db.league.findFirstOrThrow();
  await harness.say({ ...ALICE, username: "alice_fpl" }, ALICE.id, `/start join_${joinToken}`);
  await harness.tap({ ...ALICE, username: "alice_fpl" }, ALICE.id, `claim:${(await memberOf(JAZZ)).id}`);
  await harness.say(BOB, BOB.id, `/start join_${joinToken}`);
  await harness.tap(BOB, BOB.id, `claim:${(await memberOf(KINGS)).id}`);

  await harness.tick(before(TWO_DAYS + 60));
  posts.length = 0;
  calls.length = 0;
});
afterAll(() => db.$disconnect());

describe("the schedule", () => {
  it("sends nothing more than 2 days before", async () => {
    await harness.tick(before(TWO_DAYS + 1));

    expect(posts).toEqual([]);
  });

  it("sends each of the 7 rounds once, in the group and privately", async () => {
    const rounds = [48 * 60, 24 * 60, 18 * 60, 6 * 60, 3 * 60, 60, 15];
    for (const minutes of rounds) {
      await harness.tick(before(minutes));
      await harness.tick(before(minutes - 1));
    }

    expect(reminders()).toHaveLength(7);
    expect(dmsTo(ALICE.id)).toHaveLength(7);
    expect(dmsTo(BOB.id)).toHaveLength(7);
  });

  it("running twice in a round sends nothing extra (hard rule 7)", async () => {
    await harness.tick(before(TWO_DAYS));
    await harness.tick(before(TWO_DAYS));

    expect(reminders()).toHaveLength(1);
    expect(dmsTo(ALICE.id)).toHaveLength(1);
  });

  it("after downtime, sends only the latest round, not a burst", async () => {
    await harness.tick(before(5 * 60));

    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]?.text).toContain("Last call");
  });

  it("stops at the deadline", async () => {
    await harness.tick(DEADLINE);

    expect(reminders()).toEqual([]);
  });

  it("gets cheekier toward the deadline", async () => {
    await harness.tick(before(TWO_DAYS));
    await harness.tick(before(24 * 60));
    await harness.tick(before(60));

    const [first, second, third] = reminders();
    expect(first?.text).toContain("payment reminder");
    expect(second?.text).toContain("The pot is waiting");
    expect(third?.text).toContain("Last call");
  });
});

describe("who hears about it", () => {
  it("mentions by @username, by link if there's none, and by team if unclaimed", async () => {
    await harness.tick(before(TWO_DAYS));
    const text = reminders()[0]!.text;

    expect(text).toContain("@alice_fpl");
    expect(text).toContain(`<a href="tg://user?id=${BOB.id}">Bob</a>`);
    expect(text).toContain("Nat FC");
  });

  it("escapes names, so one odd team name can't break the message", async () => {
    const natFc = await memberOf(3052815);
    await db.member.update({ where: { id: natFc.id }, data: { fplTeamName: "<b>Nat & Co</b>" } });
    await harness.tick(before(TWO_DAYS));

    expect(reminders()[0]?.text).toContain("&lt;b&gt;Nat &amp; Co&lt;/b&gt;");
  });

  it("paid members and free pass holders hear nothing", async () => {
    await pay(JAZZ);
    await harness.tick(before(TWO_DAYS));

    expect(reminders()[0]?.text).not.toContain("@alice_fpl");
    expect(reminders()[0]?.text).not.toContain("Ephrem");
    expect(dmsTo(ALICE.id)).toEqual([]);
    expect(dmsTo(BOB.id)).toHaveLength(1);
  });

  it("nobody is chased once everyone has paid", async () => {
    await payAllExcept();
    await harness.tick(before(60));

    expect(posts).toEqual([]);
  });

  it("someone waiting on the coordinator isn't chased", async () => {
    const obligation = await db.obligation.findFirstOrThrow({
      where: { member: { fplEntryId: JAZZ }, gameweek: { fplEventId: 10 } },
    });
    await db.payment.create({
      data: { obligationId: obligation.id, amount: 100, method: "screenshot", verifyStatus: "needs_review" },
    });
    await harness.tick(before(TWO_DAYS));

    expect(reminders()[0]?.text).not.toContain("@alice_fpl");
    expect(dmsTo(ALICE.id)).toEqual([]);
  });

  it("the private message gives the fee, the time left and who to pay", async () => {
    await harness.say(OWNER, GROUP_ID, "/settelebirr Kibrom");
    await harness.tick(before(6 * 60));

    const text = dmsTo(ALICE.id)[0]?.text;
    expect(text).toContain("100 birr");
    expect(text).toContain("6h 0m");
    expect(text).toContain("Kibrom");
  });

  it("someone who never pressed Start still gets the group mention, and others still get theirs", async () => {
    harness.blockedChats.add(ALICE.id);
    await harness.tick(before(TWO_DAYS));

    expect(reminders()[0]?.text).toContain("@alice_fpl");
    expect(dmsTo(BOB.id)).toHaveLength(1);
  });

  it("a group post that fails is retried on the next tick, once", async () => {
    harness.telegram.down = true;
    await harness.tick(before(TWO_DAYS));
    harness.telegram.down = false;
    expect(posts).toEqual([]);

    await harness.tick(before(TWO_DAYS - 15));
    await harness.tick(before(TWO_DAYS - 30));
    expect(reminders()).toHaveLength(1);
  });
});

describe("the deadline message", () => {
  const deadlinePosts = () => groupPosts().filter((post) => post.text.includes("deadline has passed"));

  it("lists who is playing, marks free passes and gives the pot", async () => {
    await pay(JAZZ);
    await pay(KINGS);
    await harness.tick(DEADLINE);

    expect(deadlinePosts()).toHaveLength(1);
    const text = deadlinePosts()[0]!.text;
    expect(text).toContain("The GW10 deadline has passed");
    expect(text).toContain("Playing for the pot (3)");
    expect(text).toContain("Yabets M");
    expect(text).toContain("KB Gselassie");
    expect(text).toContain("Ephrem T (free pass)");
    expect(text).not.toContain("Natnael Tessema");
    expect(text).toContain("Pot: 200 birr");
  });

  it("posts once, however many ticks run", async () => {
    await harness.tick(DEADLINE);
    await harness.tick(new Date(DEADLINE.getTime() + MINUTE));

    expect(deadlinePosts()).toHaveLength(1);
  });

  it("shows anyone still waiting on the coordinator", async () => {
    const obligation = await db.obligation.findFirstOrThrow({
      where: { member: { fplEntryId: JAZZ }, gameweek: { fplEventId: 10 } },
    });
    await db.payment.create({
      data: { obligationId: obligation.id, amount: 100, method: "screenshot", verifyStatus: "needs_review" },
    });
    await harness.tick(DEADLINE);

    expect(deadlinePosts()[0]?.text).toContain("Waiting on the coordinator: Yabets M");
  });

  it("is retried if Telegram fails, and that doesn't block settling", async () => {
    harness.telegram.down = true;
    await harness.tick(DEADLINE);
    harness.telegram.down = false;
    expect(deadlinePosts()).toEqual([]);
    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } })).status).toBe("locked");

    await harness.tick(new Date(DEADLINE.getTime() + 15 * MINUTE));
    expect(deadlinePosts()).toHaveLength(1);
  });
});

describe("/status", () => {
  const statusText = async (person = ALICE, chat = GROUP_ID) => {
    calls.length = 0;
    harness.clock.now = before(30 * 60);
    await harness.say(person, chat, "/status");
    return String(calls.find((call) => call.method === "sendMessage")?.payload.text);
  };

  it("shows the deadline, time left, pot and who has paid", async () => {
    await pay(JAZZ);
    const text = await statusText();

    expect(text).toContain("GW10: deadline Fri 6 Nov, 21:30, 1d 6h left.");
    expect(text).toContain("Pot so far: 100 birr");
    expect(text).toContain("Paid (1): Yabets M");
    expect(text).toContain("Free pass (1): Ephrem T");
    expect(text).toContain("Not paid yet (9):");
  });

  it("works in private for a member", async () => {
    expect(await statusText(ALICE, ALICE.id)).toContain("GW10");
  });

  it("explains itself in private to someone with no team", async () => {
    expect(await statusText({ id: 900, first_name: "Stranger" }, 900)).toContain("isn't linked");
  });

  it("after the deadline, moves on to the next gameweek and keeps it accurate", async () => {
    await harness.tick(DEADLINE);
    calls.length = 0;
    harness.clock.now = new Date(DEADLINE.getTime() + MINUTE);
    await harness.say(ALICE, GROUP_ID, "/status");

    expect(String(calls[0]?.payload.text)).toContain("GW11");
  });
});

describe("/table", () => {
  const tableText = async () => {
    calls.length = 0;
    await harness.say(ALICE, GROUP_ID, "/table");
    return String(calls.find((call) => call.method === "sendMessage")?.payload.text);
  };

  it("uses scores after hits, not FPL's event_total", async () => {
    const text = await tableText();

    expect(text).toContain("GW9, after hits:");
    expect(text).toContain("1. Jazz: 75");
    expect(text).toContain("Nat FC: 44");
    expect(text).not.toContain("Nat FC: 52");
  });

  it("shows the overall table", async () => {
    const overall = (await tableText()).split("Overall:")[1];

    expect(overall).toContain("1. Jazz: 583");
    expect(overall).toContain("Nat FC: 517");
  });

  it("caches FPL's data rather than calling per /table", async () => {
    await tableText();
    world.fail = true;

    expect(await tableText()).toContain("1. Jazz: 75");
  });

  it("says so when FPL is down and nothing is cached", async () => {
    world.fail = true;
    calls.length = 0;
    const fresh = createHarness();
    fresh.world.fail = true;
    await fresh.say(ALICE, GROUP_ID, "/table");

    expect(fresh.takeTexts()[0]).toContain("can't reach FPL");
    await fresh.db.$disconnect();
  });

  it("keeps a member's league separate", async () => {
    calls.length = 0;
    await harness.say({ id: 900, first_name: "Stranger" }, 900, "/table");

    expect(String(calls[0]?.payload.text)).toContain("isn't linked");
  });
});

describe("two leagues", () => {
  it("reminders only go to each league's own group", async () => {
    const OTHER_GROUP = -100999;
    const STRANGER = { id: 500, first_name: "Stranger", language_code: "en" };
    await harness.say(STRANGER, OTHER_GROUP, `/setup ${LEAGUE_ID}`);
    await harness.tap(STRANGER, OTHER_GROUP, "setup:confirm");
    await harness.tick(before(TWO_DAYS + 60));
    await pay(JAZZ);
    posts.length = 0;

    await harness.tick(before(TWO_DAYS));

    const other = posts.find((post) => post.chatId === BigInt(OTHER_GROUP));
    expect(other?.text).not.toContain("@alice_fpl");
    expect(reminders()[0]?.text).not.toContain("@alice_fpl");
    expect(reminders()[0]?.text).toContain("Bob");
    expect(other?.text).toContain("Jazz");
  });
});

describe("/owe", () => {
  const owe = async (person = ALICE as typeof ALICE, chat = person.id as number) => {
    calls.length = 0;
    harness.clock.now = before(30 * 60);
    await harness.say(person, chat, "/owe");
    return String(calls.find((call) => call.method === "sendMessage")?.payload.text);
  };

  it("says what's due, by when, and who to pay", async () => {
    await harness.say(OWNER, GROUP_ID, "/settelebirr Kibrom");
    const text = await owe();

    expect(text).toContain("100 birr for GW10");
    expect(text).toContain("Fri 6 Nov, 21:30");
    expect(text).toContain("1d 6h left");
    expect(text).toContain("Kibrom");
  });

  it("says when nothing is owed", async () => {
    await pay(JAZZ);

    expect(await owe()).toContain("don't owe anything");
  });

  it("says when a payment is waiting on the coordinator", async () => {
    const obligation = await db.obligation.findFirstOrThrow({
      where: { member: { fplEntryId: JAZZ }, gameweek: { fplEventId: 10 } },
    });
    await db.payment.create({
      data: { obligationId: obligation.id, amount: 100, method: "screenshot", verifyStatus: "needs_review" },
    });

    expect(await owe()).toContain("waiting on the coordinator");
  });

  it("is private, and needs a team", async () => {
    expect(await owe(ALICE, GROUP_ID)).toContain("in private");
    expect(await owe({ id: 900, first_name: "Stranger" } as typeof ALICE)).toContain("claim link");
  });
});
