import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ALICE, clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER } from "../testing/harness.js";

const harness = createHarness();
const { db, world, posts } = harness;

const GW10_DEADLINE = new Date("2026-11-06T18:30:00Z");
const GW11_DEADLINE = new Date("2026-11-21T11:00:00Z");
const BEFORE_DEADLINE = new Date("2026-11-05T12:00:00Z");
const AFTER_MATCHES = new Date("2026-11-10T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const JAZZ = 7789411;
const KINGS = 4161001;
const NAT_FC = 3052815;
const ASRAT = 5364457;
const EPHREM = 11201236;

const memberOf = (entry: number) => db.member.findFirstOrThrow({ where: { fplEntryId: entry } });
const obligationOf = async (entry: number, gw: number) => {
  const member = await memberOf(entry);
  return db.obligation.findFirstOrThrow({ where: { memberId: member.id, gameweek: { fplEventId: gw } } });
};

/** Marks a fee paid directly. Real payments arrive in Milestone M3. */
async function pay(entry: number, gw: number, paidAt = BEFORE_DEADLINE) {
  const obligation = await obligationOf(entry, gw);
  await db.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });
  await db.payment.create({
    data: {
      obligationId: obligation.id,
      amount: obligation.amountDue,
      paidAt,
      method: "manual",
      verifyStatus: "verified",
    },
  });
}

async function payEveryone(gw: number) {
  const obligations = await db.obligation.findMany({ where: { gameweek: { fplEventId: gw }, status: "due" } });
  for (const obligation of obligations) {
    const member = await db.member.findUniqueOrThrow({ where: { id: obligation.memberId } });
    await pay(member.fplEntryId, gw);
  }
}

function finishGw(gw: number, scores: Record<number, { points: number; cost?: number; total?: number }>) {
  world.finished = { ...world.finished, [gw]: {} };
  world.scores = { ...world.scores, [gw]: scores };
  world.eventStatus = {
    status: [{ bonus_added: true, date: "2026-11-09", event: gw, points: "r" }],
    leagues: "Updated",
  };
}

/** Runs the sighting tick and the tick after the grace period. */
async function settle(at = AFTER_MATCHES) {
  await harness.tick(at);
  await harness.tick(new Date(at.getTime() + HOUR));
}

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  posts.length = 0;
  harness.calls.length = 0;

  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  await harness.tick(BEFORE_DEADLINE);
});
afterAll(() => db.$disconnect());

describe("obligations", () => {
  it("GW10: 10 members owe 100, and the GW9 runner-up has a free pass", async () => {
    const obligations = await db.obligation.findMany({ where: { gameweek: { fplEventId: 10 } } });

    expect(obligations.filter((item) => item.reason === "entry" && item.amountDue === 100)).toHaveLength(10);
    expect(await obligationOf(EPHREM, 10)).toMatchObject({ reason: "free_pass", amountDue: 0, status: "paid" });
  });

  it("running twice doesn't double anything", async () => {
    await harness.tick(BEFORE_DEADLINE);

    expect(await db.obligation.count()).toBe(11);
  });

  it("isn't created before the window opens", async () => {
    expect(await db.obligation.count({ where: { gameweek: { fplEventId: 11 } } })).toBe(0);
  });
});

describe("at the deadline", () => {
  it("locks the gameweek and waives unpaid fees", async () => {
    await pay(JAZZ, 10);
    await harness.tick(GW10_DEADLINE);

    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } })).status).toBe("locked");
    expect((await obligationOf(JAZZ, 10)).status).toBe("paid");
    expect((await obligationOf(KINGS, 10)).status).toBe("waived");
    expect((await obligationOf(EPHREM, 10)).status).toBe("paid");
  });

  it("does nothing a second before the deadline", async () => {
    await harness.tick(new Date(GW10_DEADLINE.getTime() - 1000));

    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } })).status).toBe("open");
  });
});

describe("a stuck gameweek", () => {
  it("doesn't stop the next one opening and locking", async () => {
    await harness.tick(GW10_DEADLINE);
    await harness.tick(GW11_DEADLINE);

    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } })).status).toBe("locked");
    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 11 } })).status).toBe("locked");
  });
});

describe("settling (hard rule 4)", () => {
  beforeEach(async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
  });

  it("won't settle before the bonus is added", async () => {
    finishGw(10, { [JAZZ]: { points: 90 } });
    world.eventStatus!.status[0]!.bonus_added = false;
    await settle();

    expect(await db.result.count()).toBe(0);
    expect(posts).toEqual([]);
  });

  it("won't settle before leagues are updated", async () => {
    finishGw(10, { [JAZZ]: { points: 90 } });
    world.eventStatus!.leagues = "Updating";
    await settle();

    expect(await db.result.count()).toBe(0);
  });

  it("waits for the 1-hour grace period, then settles and posts", async () => {
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });

    await harness.tick(AFTER_MATCHES);
    await harness.tick(new Date(AFTER_MATCHES.getTime() + HOUR - 1000));
    expect(await db.result.count()).toBe(0);

    await harness.tick(new Date(AFTER_MATCHES.getTime() + HOUR));
    expect(await db.result.count()).toBe(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.chatId).toBe(BigInt(GROUP_ID));
    expect(posts[0]?.text).toContain("GW10 results are final");
    expect(posts[0]?.text).toContain("Winner: Yabets M");
    expect(posts[0]?.text).toContain("Runner-up: KB Gselassie");
    expect(posts[0]?.text).toContain("Pot: 1000 birr");
    expect(posts[0]?.text).toContain("Yabets M gets 1000 birr");
    expect(posts[0]?.text).toContain("Free pass for GW11: KB Gselassie");
  });

  it("running again doesn't settle or post twice", async () => {
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    await settle();
    const after = new Date(AFTER_MATCHES.getTime() + 2 * HOUR);
    await harness.tick(after);
    await harness.tick(after);

    expect(await db.result.count()).toBe(1);
    expect(posts).toHaveLength(1);
    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 11 } })).carryIn).toBe(0);
  });

  it("if Telegram fails, the results post on a later tick, once", async () => {
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    harness.telegram.down = true;
    await settle();
    harness.telegram.down = false;

    expect(await db.result.count()).toBe(1);
    expect(posts).toEqual([]);

    const later = new Date(AFTER_MATCHES.getTime() + 2 * HOUR);
    await harness.tick(later);
    await harness.tick(later);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toContain("Winner: Yabets M");
  });

  it("scores after hits, and records the snapshot", async () => {
    finishGw(10, { [JAZZ]: { points: 90, cost: 12 }, [KINGS]: { points: 80 } });
    await settle();

    const result = await db.result.findFirstOrThrow();
    expect(result.winnerMemberIds).toEqual([(await memberOf(KINGS)).id]);

    const score = await db.score.findFirstOrThrow({ where: { memberId: (await memberOf(JAZZ)).id } });
    expect(score).toMatchObject({ points: 90, transferCost: 12, rankInGw: 2, source: "fpl" });
  });

  it("keeps trying when FPL is down, and posts nothing wrong", async () => {
    finishGw(10, { [JAZZ]: { points: 90 } });
    world.fail = true;
    await settle();
    expect(await db.result.count()).toBe(0);
    expect(posts).toEqual([]);

    world.fail = false;
    await settle(new Date(AFTER_MATCHES.getTime() + 3 * HOUR));
    expect(await db.result.count()).toBe(1);
  });

  it("settles in order: GW11 can't settle before GW10", async () => {
    finishGw(10, { [JAZZ]: { points: 90 } });
    finishGw(11, { [JAZZ]: { points: 90 } });
    world.eventStatus = {
      status: [{ bonus_added: true, date: "2026-11-25", event: 11, points: "r" }],
      leagues: "Updated",
    };
    world.finished = { 11: { dataChecked: true } };
    await settle(new Date(GW11_DEADLINE.getTime() + 24 * HOUR));

    expect(await db.result.count()).toBe(0);
  });
});

describe("money", () => {
  it("a tie shares the pot, and leftover birr rolls into the next pot", async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 90 }, [NAT_FC]: { points: 90 } });
    await settle();

    const result = await db.result.findFirstOrThrow();
    expect(result.payoutShares).toEqual([
      { memberId: (await memberOf(JAZZ)).id, amount: 333 },
      { memberId: (await memberOf(KINGS)).id, amount: 333 },
      { memberId: (await memberOf(NAT_FC)).id, amount: 333 },
    ]);
    expect(result).toMatchObject({ payoutAmount: 999, carryOut: 1 });
    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 11 } })).carryIn).toBe(1);
    expect(posts[0]?.text).toContain("1 birr rolls into the next pot");
  });

  it("an unpaid top scorer can't win or take the free pass, and the pot is smaller", async () => {
    await pay(KINGS, 10);
    await pay(NAT_FC, 10);
    await pay(ASRAT, 10);
    await harness.tick(GW10_DEADLINE);
    finishGw(10, {
      [JAZZ]: { points: 99 },
      [KINGS]: { points: 80 },
      [NAT_FC]: { points: 70 },
      [ASRAT]: { points: 60 },
    });
    await settle();

    const result = await db.result.findFirstOrThrow();
    expect(result.winnerMemberIds).toEqual([(await memberOf(KINGS)).id]);
    expect(result.runnerUpMemberIds).toEqual([(await memberOf(NAT_FC)).id]);
    expect(result.payoutAmount).toBe(300);
  });

  it("a free pass holder can win, and doesn't add to the pot", async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [EPHREM]: { points: 99 } });
    await settle();

    const result = await db.result.findFirstOrThrow();
    expect(result.winnerMemberIds).toEqual([(await memberOf(EPHREM)).id]);
    expect(result.payoutAmount).toBe(1000);
  });

  it("the runner-up's next fee becomes a free pass", async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    await settle();

    expect(await obligationOf(KINGS, 11)).toMatchObject({ reason: "free_pass", amountDue: 0, status: "paid" });
    expect(await obligationOf(JAZZ, 11)).toMatchObject({ reason: "entry", amountDue: 100, status: "due" });
  });

  it("someone who paid early, then earns a free pass, keeps it as credit for the next fee", async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    await harness.tick(new Date(GW10_DEADLINE.getTime() + HOUR));
    await pay(KINGS, 11, new Date(GW10_DEADLINE.getTime() + HOUR));

    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    await settle();

    expect(await obligationOf(KINGS, 11)).toMatchObject({ reason: "free_pass", amountDue: 0, status: "paid" });
    const gw12 = await obligationOf(KINGS, 12);
    expect(gw12).toMatchObject({ reason: "entry", amountDue: 100, status: "paid" });
    expect(await db.payment.count({ where: { obligationId: gw12.id, amount: 100 } })).toBe(1);
  });

  it("the free pass isn't counted in the following gameweek's pot, and credit is", async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    await settle();
    await harness.tick(new Date(GW11_DEADLINE.getTime() - HOUR));
    await pay(JAZZ, 11, new Date(GW11_DEADLINE.getTime() - HOUR));
    await harness.tick(GW11_DEADLINE);

    finishGw(11, { [JAZZ]: { points: 70 }, [KINGS]: { points: 90 } });
    world.finished = { 10: {}, 11: {} };
    posts.length = 0;
    await settle(new Date(GW11_DEADLINE.getTime() + 72 * HOUR));

    const gw11 = await db.gameweek.findFirstOrThrow({ where: { fplEventId: 11 } });
    expect(gw11.potAmount).toBe(100);
    expect(posts[0]?.text).toContain("Winner: KB Gselassie");
  });
});

describe("payments still under review", () => {
  beforeEach(async () => {
    await payEveryone(10);
    const obligation = await obligationOf(JAZZ, 10);
    await db.obligation.update({ where: { id: obligation.id }, data: { status: "due" } });
    await db.payment.updateMany({
      where: { obligationId: obligation.id },
      data: { verifyStatus: "needs_review", createdAt: BEFORE_DEADLINE },
    });
    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
  });

  it("settling waits and tells the coordinator once", async () => {
    await settle();
    await harness.tick(new Date(AFTER_MATCHES.getTime() + 2 * HOUR));

    expect(await db.result.count()).toBe(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.chatId).toBe(BigInt(OWNER.id));
    expect(posts[0]?.text).toContain("still need your review");
  });

  it("settles once the review is done", async () => {
    await settle();
    await db.payment.updateMany({ where: { verifyStatus: "needs_review" }, data: { verifyStatus: "rejected" } });
    await harness.tick(new Date(AFTER_MATCHES.getTime() + 2 * HOUR));

    expect(await db.result.count()).toBe(1);
  });
});

describe("R3: overrides", () => {
  async function settled() {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    await settle();
    harness.takeTexts();
    posts.length = 0;
  }
  const texts = () => harness.takeTexts().join("\n");
  const allSent = () =>
    harness.calls.filter((call) => call.method === "sendMessage").map((call) => String(call.payload.text));

  it("correcting a score re-ranks, moves the free pass, logs it and tells the group", async () => {
    await settled();
    await harness.say(OWNER, GROUP_ID, `/override score ${KINGS} 10 95`);

    const result = await db.result.findFirstOrThrow();
    expect(result.winnerMemberIds).toEqual([(await memberOf(KINGS)).id]);
    expect(result.runnerUpMemberIds).toEqual([(await memberOf(JAZZ)).id]);

    expect(await obligationOf(JAZZ, 11)).toMatchObject({ reason: "free_pass", status: "paid" });
    expect(await obligationOf(KINGS, 11)).toMatchObject({ reason: "entry", amountDue: 100, status: "due" });

    const score = await db.score.findFirstOrThrow({ where: { memberId: (await memberOf(KINGS)).id } });
    expect(score).toMatchObject({ points: 95, source: "manual" });

    const owner = await db.user.findUniqueOrThrow({ where: { telegramId: BigInt(OWNER.id) } });
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "score.override" } })).toMatchObject({
      actorId: owner.id,
      before: { points: 80, transferCost: 0 },
    });
    expect(allSent().join("\n")).toContain("Corrected result for GW10");
  });

  it("a manual score beats FPL when the gameweek settles", async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    await harness.say(OWNER, GROUP_ID, `/override score ${KINGS} 10 95`);
    expect(texts()).toContain("It will be used when GW10 settles");

    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    await settle();

    const result = await db.result.findFirstOrThrow();
    expect(result.winnerMemberIds).toEqual([(await memberOf(KINGS)).id]);
  });

  it("naming the winner by hand wins over FPL, and later score changes leave it alone", async () => {
    await settled();
    await harness.say(OWNER, GROUP_ID, `/override winner 10 ${ASRAT} runner ${NAT_FC}`);

    const result = await db.result.findFirstOrThrow();
    expect(result).toMatchObject({
      source: "manual",
      winnerMemberIds: [(await memberOf(ASRAT)).id],
      runnerUpMemberIds: [(await memberOf(NAT_FC)).id],
      payoutAmount: 1000,
    });
    expect(await obligationOf(NAT_FC, 11)).toMatchObject({ reason: "free_pass" });
    expect(await obligationOf(KINGS, 11)).toMatchObject({ reason: "entry", status: "due" });
    expect(await db.auditLog.count({ where: { action: "result.override" } })).toBe(1);
    expect(allSent().join("\n")).toContain("Corrected result for GW10");

    await harness.say(OWNER, GROUP_ID, `/override score ${JAZZ} 10 200`);
    expect((await db.result.findFirstOrThrow()).winnerMemberIds).toEqual([(await memberOf(ASRAT)).id]);
  });

  it("can settle by hand when FPL can't, and the job then leaves it alone", async () => {
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    await harness.say(OWNER, GROUP_ID, `/override winner 10 ${JAZZ},${KINGS}`);

    const gw10 = await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } });
    expect(gw10.status).toBe("settled");
    expect((await db.result.findFirstOrThrow()).payoutAmount).toBe(1000);

    finishGw(10, { [NAT_FC]: { points: 99 } });
    await settle();
    expect(await db.result.count()).toBe(1);
    expect((await db.result.findFirstOrThrow()).source).toBe("manual");
  });

  it("warns when the next gameweek has already started", async () => {
    await settled();
    await harness.tick(GW11_DEADLINE);
    await harness.say(OWNER, GROUP_ID, `/override score ${KINGS} 10 95`);

    expect(allSent().join("\n")).toContain("GW11 has already started");
    expect(await obligationOf(KINGS, 11)).toMatchObject({ reason: "free_pass" });
  });

  it("a coordinator can override; other members can't", async () => {
    await settled();
    await harness.say(ALICE, GROUP_ID, `/override score ${KINGS} 10 95`);
    expect(texts()).toContain("Only the league owner or coordinator");
    expect(await db.auditLog.count()).toBe(0);

    const reply = {
      reply_to_message: {
        message_id: 5,
        date: 0,
        chat: { id: GROUP_ID, type: "supergroup" },
        from: { is_bot: false, ...ALICE },
      },
    };
    await harness.say(OWNER, GROUP_ID, "/coordinator", reply);
    expect(texts()).toContain("Alice is now the coordinator");

    await harness.say(ALICE, GROUP_ID, `/override score ${KINGS} 10 95`);
    expect((await db.result.findFirstOrThrow()).winnerMemberIds).toEqual([(await memberOf(KINGS)).id]);
  });

  it("refuses bad input", async () => {
    await settled();
    for (const command of [
      "/override",
      "/override score 1",
      "/override winner x",
      `/override winner 10 ${JAZZ} runner`,
    ]) {
      await harness.say(OWNER, GROUP_ID, command);
      expect(texts()).toContain("To correct a score");
    }
    await harness.say(OWNER, GROUP_ID, `/override score ${JAZZ} 99 50`);
    expect(texts()).toContain("GW99 isn't part of this league");
    await harness.say(OWNER, GROUP_ID, "/override score 5 10 50");
    expect(texts()).toContain("No team with ID 5");
    await harness.say(OWNER, GROUP_ID, `/override winner 12 ${JAZZ}`);
    expect(texts()).toContain("GW12 hasn't started");
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe("R1: changing rules", () => {
  it("the owner can change a rule, and it's logged", async () => {
    await harness.say(OWNER, GROUP_ID, "/setrule scoreMode gross");

    expect(harness.takeTexts().at(-1)).toContain("scoreMode is now gross");
    expect((await db.league.findFirstOrThrow()).rules).toMatchObject({ scoreMode: "gross" });
    expect(await db.auditLog.findFirstOrThrow()).toMatchObject({
      action: "rules.update",
      before: { scoreMode: "net" },
      after: { scoreMode: "gross" },
    });
  });

  it("a rule change decides the result", async () => {
    await harness.say(OWNER, GROUP_ID, "/setrule scoreMode gross");
    await payEveryone(10);
    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [JAZZ]: { points: 90, cost: 12 }, [KINGS]: { points: 80 } });
    await settle();

    expect((await db.result.findFirstOrThrow()).winnerMemberIds).toEqual([(await memberOf(JAZZ)).id]);
  });

  it("rejects a bad value and a non-owner, and /rules shows the settings", async () => {
    harness.takeTexts();
    await harness.say(OWNER, GROUP_ID, "/setrule entryFee abc");
    expect(harness.takeTexts()[0]).toContain("isn't a valid value");

    await harness.say(ALICE, GROUP_ID, "/setrule entryFee 5");
    expect(harness.takeTexts()[0]).toContain("Only the league owner");

    await harness.say(ALICE, GROUP_ID, "/rules");
    expect(harness.takeTexts()[0]).toContain("entryFee: 100");
    expect(await db.auditLog.count()).toBe(0);
  });
});

describe("O1: two leagues in one database", () => {
  const OTHER_GROUP = -100999;
  const STRANGER = { id: 500, first_name: "Stranger", language_code: "en" };

  beforeEach(async () => {
    await harness.say(STRANGER, OTHER_GROUP, `/setup ${LEAGUE_ID}`);
    await harness.tap(STRANGER, OTHER_GROUP, "setup:confirm");
    await harness.tick(BEFORE_DEADLINE);
    harness.takeTexts();
  });

  it("each league has its own members, gameweeks and obligations", async () => {
    const [first, second] = await db.league.findMany({ orderBy: { id: "asc" } });

    expect(await db.member.count({ where: { leagueId: first!.id } })).toBe(11);
    expect(await db.member.count({ where: { leagueId: second!.id } })).toBe(11);
    const shared = await db.obligation.findMany({
      where: { member: { leagueId: first!.id }, gameweek: { leagueId: second!.id } },
    });
    expect(shared).toEqual([]);
  });

  it("the other league's owner can't touch this league", async () => {
    harness.calls.length = 0;
    await harness.say(STRANGER, GROUP_ID, `/override score ${JAZZ} 10 95`);
    await harness.say(STRANGER, GROUP_ID, `/setrule entryFee 5`);

    expect(harness.takeTexts()).toEqual([
      expect.stringContaining("Only the league owner or coordinator"),
      expect.stringContaining("Only the league owner"),
    ]);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("a payment and result in one league never reach the other", async () => {
    const [first, second] = await db.league.findMany({ orderBy: { id: "asc" } });
    const member = await db.member.findFirstOrThrow({ where: { leagueId: first!.id, fplEntryId: JAZZ } });
    const obligation = await db.obligation.findFirstOrThrow({ where: { memberId: member.id } });
    await db.obligation.update({ where: { id: obligation.id }, data: { status: "paid" } });

    await harness.tick(GW10_DEADLINE);
    finishGw(10, { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } });
    await settle();

    const results = await db.result.findMany({ include: { gameweek: true } });
    const resultFor = (leagueId: number) => results.find((result) => result.gameweek.leagueId === leagueId)!;
    expect(resultFor(first!.id).winnerMemberIds).toEqual([member.id]);
    expect(resultFor(first!.id).payoutAmount).toBe(100);
    // Nobody paid in the second league except its free pass holder.
    expect(resultFor(second!.id).payoutAmount).toBe(0);
    expect(posts.map((post) => post.chatId).sort()).toEqual([BigInt(OTHER_GROUP), BigInt(GROUP_ID)].sort());
  });
});
