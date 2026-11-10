import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DAILY_AI_CAP } from "../services/banter.js";
import { ALICE, BOB, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, ai, calls, posts, world } = harness;

const JAZZ = 7789411;
const KINGS = 4161001;
const NAT_FC = 3052815;
const HOUR = 60 * 60 * 1000;
const BOT_MENTION = "@pot_test_bot";

const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const lastTo = (chatId: number) =>
  String(calls.filter((call) => call.method === "sendMessage" && call.payload.chat_id === chatId).at(-1)?.payload.text);
const mention = (text: string) => ({
  entities: [{ type: "mention", offset: text.indexOf(BOT_MENTION), length: BOT_MENTION.length }],
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
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  ai.reply = "What a week!";
  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  const { joinToken } = await db.league.findFirstOrThrow();
  await harness.say({ ...ALICE, username: "alice_fpl" }, ALICE.id, `/start join_${joinToken}`);
  await harness.tap({ ...ALICE, username: "alice_fpl" }, ALICE.id, `claim:${(await memberOf(JAZZ)).id}`);
  await harness.say(BOB, BOB.id, `/start join_${joinToken}`);
  await harness.tap(BOB, BOB.id, `claim:${(await memberOf(KINGS)).id}`);
  calls.length = 0;
  posts.length = 0;
  ai.calls.length = 0;
});
afterAll(() => db.$disconnect());

describe("/roast", () => {
  it("roasts in persona for the owner, using the target's real numbers", async () => {
    await harness.say(OWNER, GROUP_ID, "/roast", reply(ALICE));

    expect(lastTo(GROUP_ID)).toBe("What a week!");
    expect(ai.calls[0]?.prompt).toContain("Yabets M");
    expect(ai.calls[0]?.system).toContain("You are an over-excited Ethiopian football commentator");
    expect(ai.calls[0]?.system).toContain("Never joke about religion");
  });

  it("finds someone by @username or team ID", async () => {
    await harness.say(OWNER, GROUP_ID, "/roast @ALICE_fpl");
    expect(ai.calls.at(-1)?.prompt).toContain("Yabets M");

    await harness.say(OWNER, GROUP_ID, `/roast ${NAT_FC}`);
    expect(ai.calls.at(-1)?.prompt).toContain("Natnael Tessema");
  });

  it("uses a template when there's no AI answer", async () => {
    ai.reply = undefined;
    await harness.say(OWNER, GROUP_ID, `/roast ${JAZZ}`);

    expect(lastTo(GROUP_ID)).toContain("Yabets M, the data has spoken");
  });

  it("is for the owner and coordinator, in the group, with a target", async () => {
    await harness.say(ALICE, GROUP_ID, `/roast ${KINGS}`);
    expect(lastTo(GROUP_ID)).toContain("Only the league owner or coordinator");

    await harness.say(OWNER, OWNER.id, `/roast ${KINGS}`);
    expect(lastTo(OWNER.id)).toContain("belong in the group");

    await harness.say(OWNER, GROUP_ID, "/roast");
    expect(lastTo(GROUP_ID)).toContain("Reply to someone with /roast");
    expect(ai.calls).toEqual([]);
  });
});

describe("/nofun", () => {
  it("stops roasts, and /funon brings them back", async () => {
    await harness.say(ALICE, ALICE.id, "/nofun");
    expect(lastTo(ALICE.id)).toContain("won't roast you");
    expect((await memberOf(JAZZ)).roastOptOut).toBe(true);

    await harness.say(OWNER, GROUP_ID, `/roast ${JAZZ}`);
    expect(lastTo(GROUP_ID)).toContain("opted out");
    expect(ai.calls).toEqual([]);

    await harness.say(ALICE, ALICE.id, "/funon");
    expect((await memberOf(JAZZ)).roastOptOut).toBe(false);
  });

  it("tells the AI not to name them, and discards text that does anyway", async () => {
    await harness.say(ALICE, ALICE.id, "/nofun");
    ai.reply = "Yabets M is hopeless";
    await harness.say(BOB, GROUP_ID, `hi ${BOT_MENTION}`, mention(`hi ${BOT_MENTION}`));

    expect(ai.calls[0]?.system).toContain("Yabets M");
    expect(lastTo(GROUP_ID)).not.toContain("hopeless");
    expect(lastTo(GROUP_ID)).toContain("busy watching the scores");
  });

  it("keeps their facts away from the AI", async () => {
    await db.memberFact.create({
      data: { memberId: (await memberOf(JAZZ)).id, fact: "loves Arsenal", source: "admin" },
    });
    await harness.say(ALICE, ALICE.id, "/nofun");
    await harness.tick(new Date("2026-11-01T12:00:00Z"));
    await db.obligation.updateMany({ where: { status: "due" }, data: { status: "paid" } });
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    const after = new Date("2026-11-10T12:00:00Z");
    await harness.tick(after);
    ai.calls.length = 0;
    await harness.tick(new Date(after.getTime() + HOUR));

    expect(ai.calls.length).toBeGreaterThan(0);
    expect(ai.calls.map((call) => call.prompt).join()).not.toContain("loves Arsenal");
  });
});

describe("replies when mentioned", () => {
  it("answers a mention, and a reply to the bot", async () => {
    await harness.say(BOB, GROUP_ID, `who's winning ${BOT_MENTION}?`, mention(`who's winning ${BOT_MENTION}?`));
    expect(lastTo(GROUP_ID)).toBe("What a week!");
    expect(ai.calls[0]?.prompt).toContain("who's winning");

    await harness.say(BOB, GROUP_ID, "you're wrong", {
      reply_to_message: {
        message_id: 9,
        date: 0,
        chat: { id: GROUP_ID, type: "supergroup" },
        from: { id: 1, is_bot: true, first_name: "Pot Bot" },
      },
    });
    expect(ai.calls).toHaveLength(2);
  });

  it("ignores ordinary chat and someone else's mention", async () => {
    await harness.say(BOB, GROUP_ID, "nice goal");
    await harness.say(BOB, GROUP_ID, "@someone_else hi", { entities: [{ type: "mention", offset: 0, length: 13 }] });
    await harness.say(BOB, GROUP_ID, "lol", reply(ALICE));

    expect(ai.calls).toEqual([]);
    expect(calls.filter((call) => call.method === "sendMessage")).toEqual([]);
  });

  it("uses the template with no AI answer, and stays quiet in a group with no league", async () => {
    ai.reply = undefined;
    await harness.say(BOB, GROUP_ID, `hi ${BOT_MENTION}`, mention(`hi ${BOT_MENTION}`));
    expect(lastTo(GROUP_ID)).toContain("busy watching the scores");

    calls.length = 0;
    await harness.say(BOB, -555, `hi ${BOT_MENTION}`, mention(`hi ${BOT_MENTION}`));
    expect(calls).toEqual([]);
  });

  it("the daily cap switches to templates (hard rule 15)", async () => {
    const league = await db.league.findFirstOrThrow();
    await db.messageLog.createMany({
      data: Array.from({ length: DAILY_AI_CAP }, (_, index) => ({
        leagueId: league.id,
        dedupeKey: `ai:old:${index}`,
        kind: "ai_text",
        sentAt: harness.clock.now,
      })),
    });
    await harness.say(BOB, GROUP_ID, `hi ${BOT_MENTION}`, mention(`hi ${BOT_MENTION}`));

    expect(ai.calls).toEqual([]);
    expect(lastTo(GROUP_ID)).toContain("busy watching the scores");
  });
});

describe("sharing the AI allowance", () => {
  const CHAT_LIMIT = 20;
  const fillChat = async (count: number) => {
    const league = await db.league.findFirstOrThrow();
    await db.messageLog.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        leagueId: league.id,
        dedupeKey: `ai-chat:old:${index}`,
        kind: "ai_mention",
        sentAt: harness.clock.now,
      })),
    });
  };

  it("mention replies stop at their own limit, leaving room for the recap and /roast", async () => {
    await fillChat(CHAT_LIMIT);
    await harness.say(BOB, GROUP_ID, `hi ${BOT_MENTION}`, mention(`hi ${BOT_MENTION}`));
    expect(ai.calls).toEqual([]);
    expect(lastTo(GROUP_ID)).toContain("busy watching the scores");

    await harness.say(OWNER, GROUP_ID, `/roast ${JAZZ}`);
    expect(ai.calls).toHaveLength(1);
    expect(lastTo(GROUP_ID)).toBe("What a week!");
  });

  it("mention replies still count toward the league's total", async () => {
    await fillChat(CHAT_LIMIT);
    const league = await db.league.findFirstOrThrow();
    await db.messageLog.createMany({
      data: Array.from({ length: DAILY_AI_CAP - CHAT_LIMIT }, (_, index) => ({
        leagueId: league.id,
        dedupeKey: `ai:old:${index}`,
        kind: "ai_text",
        sentAt: harness.clock.now,
      })),
    });
    await harness.say(OWNER, GROUP_ID, `/roast ${JAZZ}`);

    expect(ai.calls).toEqual([]);
  });
});

describe("the recap", () => {
  async function settle() {
    await harness.tick(new Date("2026-11-01T12:00:00Z"));
    await db.obligation.updateMany({ where: { status: "due" }, data: { status: "paid" } });
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 }, [KINGS]: { points: 80, cost: 4 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    const after = new Date("2026-11-10T12:00:00Z");
    await harness.tick(after);
    posts.length = 0;
    ai.calls.length = 0;
    await harness.tick(new Date(after.getTime() + HOUR));
    await harness.tick(new Date(after.getTime() + 2 * HOUR));
  }

  it("posts once after the awards, built from real scores and stored facts", async () => {
    await db.memberFact.create({
      data: { memberId: (await memberOf(KINGS)).id, fact: "says it's his year", source: "admin" },
    });
    ai.reply = "GW10 was wild!";
    await settle();

    const texts = posts.map((post) => post.text);
    const awards = texts.findIndex((text) => text.includes("GW10 awards"));
    expect(texts.indexOf("GW10 was wild!")).toBeGreaterThan(awards);
    expect(texts.filter((text) => text === "GW10 was wild!")).toHaveLength(1);

    const recap = ai.calls.find((call) => call.prompt.includes("recap"));
    expect(recap?.prompt).toContain("Winner: Yabets M");
    expect(recap?.prompt).toContain("KB Gselassie: 76 (hits 4");
    expect(recap?.prompt).toContain("says it's his year");
  });

  it("with no AI, uses a plain line", async () => {
    ai.reply = undefined;
    await settle();

    expect(posts.map((post) => post.text)).toContain(
      "That's GW10 done. Congratulations to Yabets M. Next week, everyone starts again.",
    );
  });
});

describe("reminder quips", () => {
  const groupReminders = () => posts.filter((post) => post.parseMode === "HTML").map((post) => post.text);

  it("adds a line to cheeky and urgent reminders, escaped, but not to the first polite one", async () => {
    await harness.tick(new Date("2026-11-04T18:30:00Z"));
    expect(groupReminders()[0]).not.toContain("<3");

    ai.reply = "Pay up <3";
    await harness.tick(new Date("2026-11-05T18:30:00Z"));
    expect(groupReminders()[1]).toContain("Pay up &lt;3");
    expect(ai.calls[0]?.prompt).toContain("Name nobody");
  });

  it("still sends the reminder when the AI fails", async () => {
    ai.reply = undefined;
    await harness.tick(new Date("2026-11-05T18:30:00Z"));

    expect(groupReminders()[0]).toContain("still haven't paid");
  });
});

describe("/persona", () => {
  it("shows and changes the voice, and is logged", async () => {
    await harness.say(OWNER, GROUP_ID, "/persona");
    expect(lastTo(GROUP_ID)).toContain("Persona: commentator. Spice: 3 of 5");

    await harness.say(OWNER, GROUP_ID, "/persona pundit 5");
    expect(lastTo(GROUP_ID)).toContain("pundit, with spice 5");
    expect(await db.auditLog.count({ where: { action: "persona.update" } })).toBe(1);

    await harness.say(OWNER, GROUP_ID, `/roast ${JAZZ}`);
    expect(ai.calls[0]?.system).toContain("deadpan television pundit");
    expect(ai.calls[0]?.system).toContain("Spice level 5 of 5");
  });

  it("refuses a bad name or spice, and members", async () => {
    for (const command of ["/persona wizard", "/persona pundit 9"]) {
      await harness.say(OWNER, GROUP_ID, command);
      expect(lastTo(GROUP_ID)).toContain("Use /persona");
    }
    await harness.say(ALICE, GROUP_ID, "/persona pundit");
    expect(lastTo(GROUP_ID)).toContain("Only the league owner or coordinator");
  });
});

describe("F3: /fact and /me", () => {
  it("a fact can be seen and deleted by that member", async () => {
    await harness.say(OWNER, GROUP_ID, `/fact ${JAZZ} says every season is his year`);
    expect(lastTo(GROUP_ID)).toContain("Noted for Yabets M");
    expect(await db.auditLog.count({ where: { action: "fact.add" } })).toBe(1);

    await harness.say(ALICE, ALICE.id, "/me");
    expect(lastTo(ALICE.id)).toContain("says every season is his year");
    const fact = await db.memberFact.findFirstOrThrow();

    await harness.tap(ALICE, ALICE.id, `fact:del:${fact.id}`);
    expect(await db.memberFact.count()).toBe(0);
    expect(String(calls.at(-1)?.payload.text)).toContain("don't have any facts");
  });

  it("delete all removes only the sender's own", async () => {
    const [jazz, kings] = [await memberOf(JAZZ), await memberOf(KINGS)];
    await db.memberFact.createMany({
      data: [
        { memberId: jazz.id, fact: "one", source: "admin" },
        { memberId: jazz.id, fact: "two", source: "admin" },
        { memberId: kings.id, fact: "bob's", source: "admin" },
      ],
    });
    await harness.tap(ALICE, ALICE.id, "fact:clear");

    expect((await db.memberFact.findMany()).map((item) => item.fact)).toEqual(["bob's"]);
  });

  it("nobody can delete someone else's fact", async () => {
    const fact = await db.memberFact.create({
      data: { memberId: (await memberOf(KINGS)).id, fact: "bob's", source: "admin" },
    });
    await harness.tap(ALICE, ALICE.id, `fact:del:${fact.id}`);

    expect(await db.memberFact.count()).toBe(1);
  });

  it("/me shows paid, won and net", async () => {
    const jazz = await memberOf(JAZZ);
    await harness.tick(new Date("2026-11-01T12:00:00Z"));
    const obligation = await db.obligation.findFirstOrThrow({ where: { memberId: jazz.id } });
    await db.payment.create({
      data: { obligationId: obligation.id, amount: 100, method: "manual", verifyStatus: "verified" },
    });
    const gameweek = await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } });
    await db.result.create({
      data: {
        gameweekId: gameweek.id,
        winnerMemberIds: [jazz.id],
        runnerUpMemberIds: [],
        payoutAmount: 900,
        payoutShares: [{ memberId: jazz.id, amount: 900 }],
      },
    });
    await harness.say(ALICE, ALICE.id, "/me");

    expect(lastTo(ALICE.id)).toContain("Paid in: 100 birr. Won: 900 birr. Net: 800 birr.");
  });

  it("/me is private, and needs a team", async () => {
    await harness.say(ALICE, GROUP_ID, "/me");
    expect(lastTo(GROUP_ID)).toContain("in private");

    await harness.say({ id: 900, first_name: "Stranger" }, 900, "/me");
    expect(lastTo(900)).toContain("claim link");
  });

  it("/fact refuses members, bad input, and someone who opted out", async () => {
    await harness.say(ALICE, GROUP_ID, `/fact ${KINGS} hello`);
    expect(lastTo(GROUP_ID)).toContain("Only the league owner or coordinator");

    await harness.say(OWNER, GROUP_ID, `/fact ${JAZZ}`);
    expect(lastTo(GROUP_ID)).toContain("Use /fact");

    await harness.say(ALICE, ALICE.id, "/nofun");
    await harness.say(OWNER, GROUP_ID, `/fact ${JAZZ} hello`);
    expect(lastTo(GROUP_ID)).toContain("opted out");
    expect(await db.memberFact.count()).toBe(0);
  });
});
