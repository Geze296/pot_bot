import { createFplClient } from "@potbot/fpl";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ledgerCsv, leagueLedger } from "../services/ledger.js";
import { clearDatabase, createHarness, GROUP_ID, LEAGUE_ID, OWNER, ALICE } from "../testing/harness.js";
import { signInitData } from "../testing/init-data.js";
import { apiRoutes } from "./routes.js";
import { createApi } from "./server.js";

const TOKEN = "123:test-token";
const NOW = new Date("2026-11-05T12:00:00Z");
const KIBROM = { id: 200, first_name: "Kibrom", language_code: "en" };
const STRANGER = { id: 500, first_name: "Stranger", language_code: "en" };
const JAZZ = 7789411;
const KINGS = 4161001;
const NAT_FC = 3052815;

const harness = createHarness();
const { db, fpl, world } = harness;
const posts: { chatId: bigint; text: string }[] = [];
const documents: { chatId: bigint; filename: string; content: string }[] = [];
const screenshots: { chatId: bigint; fileId: string; isPhoto: boolean; caption: string }[] = [];
let screenshotsFail = false;
let documentsFail = false;
let api: FastifyInstance;

type Person = { id: number; first_name: string };
const reply = (person: Person) => ({
  reply_to_message: {
    message_id: 5,
    date: 0,
    chat: { id: GROUP_ID, type: "supergroup" },
    from: { is_bot: false, ...person },
  },
});

const call = (person: Person | null, method: "GET" | "POST" | "DELETE", url: string, payload?: object) =>
  api.inject({
    method,
    url: `/api${url}`,
    ...(person ? { headers: { authorization: `tma ${signInitData(person, TOKEN, NOW)}` } } : {}),
    ...(payload ? { payload } : {}),
  });

const memberOf = (entry: number, leagueId?: number) =>
  db.member.findFirstOrThrow({ where: { fplEntryId: entry, ...(leagueId ? { leagueId } : {}) } });
const obligationOf = (entry: number, gw = 10) =>
  db.obligation.findFirstOrThrow({ where: { member: { fplEntryId: entry }, gameweek: { fplEventId: gw } } });

let leagueId: number;

beforeAll(async () => {
  api = await createApi({
    checkDb: async () => {},
    routes: apiRoutes({
      db,
      fpl,
      botToken: TOKEN,
      now: () => NOW,
      send: async (chatId, text) => {
        posts.push({ chatId, text });
      },
      sendDocument: async (chatId, filename, content) => {
        if (documentsFail) throw new Error("Forbidden");
        documents.push({ chatId, filename, content });
      },
      sendScreenshot: async (chatId, { fileId, isPhoto }, caption) => {
        if (screenshotsFail) throw new Error("Forbidden");
        screenshots.push({ chatId, fileId, isPhoto, caption });
      },
    }),
  });
});

beforeEach(async () => {
  await clearDatabase(db);
  for (const key of Object.keys(world)) delete world[key as keyof typeof world];
  posts.length = 0;
  documents.length = 0;
  documentsFail = false;
  screenshots.length = 0;
  screenshotsFail = false;

  await harness.say(OWNER, GROUP_ID, `/setup ${LEAGUE_ID}`);
  await harness.tap(OWNER, GROUP_ID, "setup:confirm");
  await harness.say(OWNER, GROUP_ID, "/coordinator", reply(KIBROM));
  const league = await db.league.findFirstOrThrow();
  leagueId = league.id;
  await harness.say(ALICE, ALICE.id, `/start join_${league.joinToken}`);
  await harness.tap(ALICE, ALICE.id, `claim:${(await memberOf(JAZZ)).id}`);
  await harness.tick(NOW);
});
afterAll(() => db.$disconnect());

describe("login", () => {
  it("refuses no login, a forged one, and an expired one, on every kind of route", async () => {
    const urls = ["/me", `/leagues/${leagueId}/dashboard`, `/leagues/${leagueId}/audit`];
    const forged = new URLSearchParams(signInitData(ALICE, TOKEN, NOW));
    forged.set("user", JSON.stringify(OWNER));
    const expired = signInitData(ALICE, TOKEN, new Date(NOW.getTime() - 25 * 60 * 60 * 1000));

    for (const url of urls) {
      expect((await call(null, "GET", url)).statusCode).toBe(401);
      for (const initData of [forged.toString(), expired, signInitData(ALICE, "999:other-bot", NOW)]) {
        const response = await api.inject({
          method: "GET",
          url: `/api${url}`,
          headers: { authorization: `tma ${initData}` },
        });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: "unauthorized" });
      }
    }
  });

  it("/me lists the caller's leagues with their role", async () => {
    expect((await call(OWNER, "GET", "/me")).json().leagues).toEqual([{ id: leagueId, name: "Office", role: "owner" }]);
    expect((await call(KIBROM, "GET", "/me")).json().leagues[0].role).toBe("coordinator");
    expect((await call(ALICE, "GET", "/me")).json().leagues[0].role).toBe("member");
    expect((await call(STRANGER, "GET", "/me")).json().leagues).toEqual([]);
  });
});

describe("A1: who can do what", () => {
  type Check = [string, "GET" | "POST" | "DELETE", () => string | Promise<string>, (object | undefined)?];
  const EVERYONE: Check[] = [
    ["dashboard", "GET", () => `/leagues/${leagueId}/dashboard`],
    ["results", "GET", () => `/leagues/${leagueId}/results`],
    ["ledger", "GET", () => `/leagues/${leagueId}/ledger`],
    ["table", "GET", () => `/leagues/${leagueId}/table`],
  ];
  const MANAGERS: Check[] = [
    ["payments", "GET", () => `/leagues/${leagueId}/payments`],
    ["members", "GET", () => `/leagues/${leagueId}/members`],
    ["rules", "GET", () => `/leagues/${leagueId}/rules`],
    ["audit", "GET", () => `/leagues/${leagueId}/audit`],
    ["ledger export", "POST", () => `/leagues/${leagueId}/ledger/send`],
    ["screenshot", "POST", () => `/leagues/${leagueId}/payments/1/screenshot`],
    ["telebirr", "POST", () => `/leagues/${leagueId}/telebirr`, { name: "Kibrom" }],
    ["mark", "POST", () => `/leagues/${leagueId}/payments/mark`, {}],
    ["decide", "POST", () => `/leagues/${leagueId}/payments/1/decide`, { approve: true }],
    ["score", "POST", () => `/leagues/${leagueId}/results/10/score`, {}],
    ["winner", "POST", () => `/leagues/${leagueId}/results/10/winner`, {}],
    ["payout", "POST", () => `/leagues/${leagueId}/results/10/payout`, {}],
    ["status", "POST", async () => `/leagues/${leagueId}/members/${(await memberOf(KINGS)).id}/status`, {}],
    ["unlink", "POST", async () => `/leagues/${leagueId}/members/${(await memberOf(JAZZ)).id}/unlink`],
    ["fact", "POST", async () => `/leagues/${leagueId}/members/${(await memberOf(JAZZ)).id}/facts`, {}],
    ["fact delete", "DELETE", async () => `/leagues/${leagueId}/members/${(await memberOf(JAZZ)).id}/facts/1`],
  ];
  const OWNER_ONLY: Check[] = [
    ["rule change", "POST", () => `/leagues/${leagueId}/rules`, { key: "entryFee", value: "50" }],
    ["persona", "POST", () => `/leagues/${leagueId}/persona`, { name: "pundit", spice: 2 }],
    ["coordinator", "POST", () => `/leagues/${leagueId}/coordinator`, {}],
  ];
  const statusOf = async ([, method, url, payload]: Check, person: Person) =>
    (await call(person, method, await url(), payload)).statusCode;

  it.each(EVERYONE)("%s is open to members, and closed to strangers", async (...check) => {
    expect(await statusOf(check as Check, ALICE)).toBe(200);
    expect(await statusOf(check as Check, STRANGER)).toBe(403);
  });

  it.each(MANAGERS)("%s is closed to members and strangers, and open to managers", async (...check) => {
    expect(await statusOf(check as Check, ALICE)).toBe(403);
    expect(await statusOf(check as Check, STRANGER)).toBe(403);
    for (const manager of [KIBROM, OWNER]) {
      expect(await statusOf(check as Check, manager)).not.toBe(403);
    }
  });

  it.each(OWNER_ONLY)("%s is for the owner alone", async (...check) => {
    for (const person of [KIBROM, ALICE, STRANGER]) {
      expect(await statusOf(check as Check, person)).toBe(403);
    }
    expect(await statusOf(check as Check, OWNER)).not.toBe(403);
  });

  it("a refused request changes nothing", async () => {
    await call(ALICE, "POST", `/leagues/${leagueId}/rules`, { key: "entryFee", value: "1" });
    await call(ALICE, "POST", `/leagues/${leagueId}/payments/mark`, {
      memberId: (await memberOf(JAZZ)).id,
      gameweek: 10,
      paid: true,
    });

    expect((await db.league.findFirstOrThrow()).rules).toMatchObject({ entryFee: 100 });
    expect((await obligationOf(JAZZ)).status).toBe("due");
  });
});

describe("two leagues", () => {
  const OTHER_GROUP = -100999;
  let otherId: number;

  beforeEach(async () => {
    await harness.say(STRANGER, OTHER_GROUP, `/setup ${LEAGUE_ID}`);
    await harness.tap(STRANGER, OTHER_GROUP, "setup:confirm");
    otherId = (await db.league.findFirstOrThrow({ where: { telegramChatId: BigInt(OTHER_GROUP) } })).id;
    await harness.tick(NOW);
  });

  it("a manager of one can't read or change the other", async () => {
    for (const url of ["dashboard", "payments", "members", "ledger", "audit", "rules"]) {
      expect((await call(STRANGER, "GET", `/leagues/${leagueId}/${url}`)).statusCode).toBe(403);
      expect((await call(OWNER, "GET", `/leagues/${otherId}/${url}`)).statusCode).toBe(403);
    }
  });

  it("IDs from the other league aren't accepted, even by a manager", async () => {
    const theirMember = await memberOf(JAZZ, otherId);
    const responses = await Promise.all([
      call(OWNER, "POST", `/leagues/${leagueId}/payments/mark`, { memberId: theirMember.id, gameweek: 10, paid: true }),
      call(OWNER, "POST", `/leagues/${leagueId}/members/${theirMember.id}/status`, { status: "paused" }),
      call(OWNER, "POST", `/leagues/${leagueId}/results/10/score`, { memberId: theirMember.id, points: 99 }),
    ]);
    for (const response of responses) expect(response.statusCode).toBe(404);

    const obligation = await db.obligation.findFirstOrThrow({ where: { memberId: theirMember.id } });
    const payment = await db.payment.create({
      data: { obligationId: obligation.id, amount: 100, method: "screenshot", verifyStatus: "needs_review" },
    });
    const decide = await call(OWNER, "POST", `/leagues/${leagueId}/payments/${payment.id}/decide`, { approve: true });
    expect(decide.statusCode).toBe(404);

    await db.payment.update({ where: { id: payment.id }, data: { screenshotFileId: "their-file" } });
    const screenshot = await call(OWNER, "POST", `/leagues/${leagueId}/payments/${payment.id}/screenshot`);
    expect(screenshot.statusCode).toBe(404);
    expect(screenshots).toEqual([]);

    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).verifyStatus).toBe("needs_review");
  });
});

describe("dashboard", () => {
  it("shows the gameweek, pot and who stands where", async () => {
    await db.obligation.update({ where: { id: (await obligationOf(JAZZ)).id }, data: { status: "paid" } });
    const data = (await call(ALICE, "GET", `/leagues/${leagueId}/dashboard`)).json();

    expect(data).toMatchObject({
      role: "member",
      timezone: "Africa/Addis_Ababa",
      team: "Jazz",
      pot: 100,
      paid: ["Yabets M"],
      freePass: ["Ephrem T"],
      gameweek: { event: 10, status: "open", deadlineAt: "2026-11-06T18:30:00.000Z" },
      yourStatus: { status: "paid", reason: "entry" },
    });
    expect(data.unpaid).toHaveLength(9);
  });
});

describe("the table", () => {
  it("shows the gameweek after hits and the overall table, and which team is yours", async () => {
    const data = (await call(ALICE, "GET", `/leagues/${leagueId}/table`)).json();

    expect(data.yourTeam).toBe("Jazz");
    expect(data.table.event).toBe(9);
    expect(data.table.finished).toBe(true);
    expect(data.table.gameweek[0]).toEqual({ team: "Jazz", value: 75, rank: 1 });
    expect(data.table.gameweek.find((row: { team: string }) => row.team === "Nat FC").value).toBe(44);
    expect(data.table.overall[0]).toEqual({ team: "Jazz", value: 583, rank: 1 });
  });

  it("explains when FPL is down and nothing is cached", async () => {
    const fresh = await createApi({
      checkDb: async () => {},
      routes: apiRoutes({
        db,
        fpl: createFplClient({ fetch: async () => new Response("{}", { status: 503 }), sleep: async () => {} }),
        botToken: TOKEN,
        now: () => NOW,
        send: async () => {},
        sendDocument: async () => {},
        sendScreenshot: async () => {},
      }),
    });
    const response = await fresh.inject({
      method: "GET",
      url: `/api/leagues/${leagueId}/table`,
      headers: { authorization: `tma ${signInitData(ALICE, TOKEN, NOW)}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "fpl_down" });
  });
});

describe("how to pay, on the dashboard", () => {
  const dashboard = async () => (await call(ALICE, "GET", `/leagues/${leagueId}/dashboard`)).json();

  it("gives the fee and who to pay while it's due", async () => {
    await call(OWNER, "POST", `/leagues/${leagueId}/telebirr`, { name: "Kibrom" });

    expect(await dashboard()).toMatchObject({
      yourStatus: { status: "due", amountDue: 100 },
      receiver: "Kibrom",
      yourPaymentInReview: false,
    });
  });

  it("says when their payment is under review", async () => {
    const obligation = await obligationOf(JAZZ);
    await db.payment.create({
      data: { obligationId: obligation.id, amount: 100, method: "screenshot", verifyStatus: "needs_review" },
    });

    expect((await dashboard()).yourPaymentInReview).toBe(true);
  });
});

describe("payments", () => {
  async function review() {
    const obligation = await obligationOf(JAZZ);
    return db.payment.create({
      data: {
        obligationId: obligation.id,
        txnId: "DJVREVIEW1",
        amount: 100,
        method: "screenshot",
        verifyStatus: "needs_review",
        verifyReason: "unreadable",
        createdAt: NOW,
      },
    });
  }

  it("lists reviews and everyone's fee", async () => {
    await review();
    const data = (await call(KIBROM, "GET", `/leagues/${leagueId}/payments`)).json();

    expect(data.reviews[0]).toMatchObject({
      manager: "Yabets M",
      gameweek: 10,
      reason: "unreadable",
      txnId: "DJVREVIEW1",
    });
    expect(data.members).toHaveLength(11);
  });

  it("approving marks paid, logs it, tells the member and the group, and works once", async () => {
    const payment = await review();
    const url = `/leagues/${leagueId}/payments/${payment.id}/decide`;
    expect((await call(KIBROM, "POST", url, { approve: true })).statusCode).toBe(200);

    expect((await obligationOf(JAZZ)).status).toBe("paid");
    expect(await db.auditLog.count({ where: { action: "payment.approve" } })).toBe(1);
    expect(posts.map((post) => post.chatId)).toEqual([BigInt(ALICE.id), BigInt(GROUP_ID)]);
    expect(posts[1]?.text).toContain("Yabets M paid for GW10");

    const again = await call(KIBROM, "POST", url, { approve: false });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "already_decided" });
  });

  describe("Send me the screenshot", () => {
    const withImage = async () => {
      const payment = await review();
      return db.payment.update({
        where: { id: payment.id },
        data: { screenshotFileId: "tg-file-1", screenshotIsPhoto: true },
      });
    };

    it("sends it to the manager who asked, in private, with whose it is", async () => {
      const payment = await withImage();
      expect((await call(KIBROM, "GET", `/leagues/${leagueId}/payments`)).json().reviews[0].hasScreenshot).toBe(true);

      const response = await call(KIBROM, "POST", `/leagues/${leagueId}/payments/${payment.id}/screenshot`);
      expect(response.statusCode).toBe(200);
      expect(screenshots[0]).toMatchObject({ chatId: BigInt(KIBROM.id), fileId: "tg-file-1", isPhoto: true });
      expect(screenshots[0]?.caption).toContain("Yabets M");
    });

    it("never puts the reference in the API response", async () => {
      await withImage();
      const raw = (await call(KIBROM, "GET", `/leagues/${leagueId}/payments`)).body;

      expect(raw).not.toContain("tg-file-1");
    });

    it("forgets the reference once decided (hard rule 12)", async () => {
      const payment = await withImage();
      await call(KIBROM, "POST", `/leagues/${leagueId}/payments/${payment.id}/decide`, { approve: false });

      const saved = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(saved).toMatchObject({ screenshotFileId: null, screenshotIsPhoto: null });
      const again = await call(KIBROM, "POST", `/leagues/${leagueId}/payments/${payment.id}/screenshot`);
      expect(again.json()).toEqual({ error: "no_screenshot" });
    });

    it("explains when it can't message them", async () => {
      const payment = await withImage();
      screenshotsFail = true;
      const response = await call(KIBROM, "POST", `/leagues/${leagueId}/payments/${payment.id}/screenshot`);

      expect(response.json()).toEqual({ error: "cant_message_you" });
    });
  });

  it("rejecting tells only the member", async () => {
    const payment = await review();
    await call(KIBROM, "POST", `/leagues/${leagueId}/payments/${payment.id}/decide`, { approve: false });

    expect((await obligationOf(JAZZ)).status).toBe("due");
    expect(posts.map((post) => post.chatId)).toEqual([BigInt(ALICE.id)]);
  });

  it("marks paid and unpaid, logged, and refuses twice", async () => {
    const memberId = (await memberOf(KINGS)).id;
    const url = `/leagues/${leagueId}/payments/mark`;

    expect((await call(KIBROM, "POST", url, { memberId, gameweek: 10, paid: true })).statusCode).toBe(200);
    expect((await obligationOf(KINGS)).status).toBe("paid");
    expect((await call(KIBROM, "POST", url, { memberId, gameweek: 10, paid: true })).json()).toEqual({
      error: "already",
    });

    expect((await call(KIBROM, "POST", url, { memberId, gameweek: 10, paid: false })).statusCode).toBe(200);
    expect((await obligationOf(KINGS)).status).toBe("due");
    expect(await db.auditLog.count({ where: { action: { in: ["payment.mark_paid", "payment.mark_unpaid"] } } })).toBe(
      2,
    );
  });

  it("refuses bad input", async () => {
    const url = `/leagues/${leagueId}/payments/mark`;
    for (const payload of [
      {},
      { memberId: "x", gameweek: 10, paid: true },
      { memberId: 1.5, gameweek: 10, paid: true },
    ]) {
      expect((await call(KIBROM, "POST", url, payload)).statusCode).toBe(400);
    }
  });
});

describe("results", () => {
  async function settled() {
    await db.obligation.updateMany({
      where: { status: "due", gameweek: { fplEventId: 10 } },
      data: { status: "paid" },
    });
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 }, [KINGS]: { points: 80, cost: 4 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    await harness.tick(new Date("2026-11-10T12:00:00Z"));
    await harness.tick(new Date("2026-11-10T13:00:00Z"));
    posts.length = 0;
  }

  it("shows scores after hits, winners and payouts", async () => {
    await settled();
    const { gameweeks } = (await call(ALICE, "GET", `/leagues/${leagueId}/results`)).json();

    expect(gameweeks[0].event).toBe(10);
    expect(gameweeks[0].result.winners).toEqual(["Yabets M"]);
    expect(gameweeks[0].result.shares[0]).toMatchObject({ manager: "Yabets M", amount: 1000, paid: false });
    expect(gameweeks[0].scores[0]).toMatchObject({ manager: "Yabets M", net: 90 });
    expect(gameweeks[0].scores[1]).toMatchObject({ manager: "KB Gselassie", points: 80, transferCost: 4, net: 76 });
  });

  it("correcting a score re-ranks, logs it and tells the group, as /override does", async () => {
    await settled();
    const memberId = (await memberOf(KINGS)).id;
    const response = await call(KIBROM, "POST", `/leagues/${leagueId}/results/10/score`, { memberId, points: 99 });

    expect(response.statusCode).toBe(200);
    expect((await db.result.findFirstOrThrow()).winnerMemberIds).toEqual([memberId]);
    expect(await db.auditLog.count({ where: { action: "score.override" } })).toBe(1);
    expect(posts.some((post) => post.text.includes("Corrected result for GW10"))).toBe(true);
  });

  it("naming a winner works, and not before the gameweek starts", async () => {
    await settled();
    const natFc = (await memberOf(NAT_FC)).id;
    const response = await call(OWNER, "POST", `/leagues/${leagueId}/results/10/winner`, { winnerIds: [natFc] });

    expect(response.statusCode).toBe(200);
    expect(await db.result.findFirstOrThrow()).toMatchObject({ source: "manual", winnerMemberIds: [natFc] });

    const early = await call(OWNER, "POST", `/leagues/${leagueId}/results/12/winner`, { winnerIds: [natFc] });
    expect(early.json()).toEqual({ error: "not_started" });
  });

  it("recording a payout logs it, tells the group, and works once", async () => {
    await settled();
    const memberId = (await memberOf(JAZZ)).id;
    const url = `/leagues/${leagueId}/results/10/payout`;
    const response = await call(KIBROM, "POST", url, { memberId, txnId: "djvabc1234" });

    expect(response.statusCode).toBe(200);
    expect(await db.payout.findFirstOrThrow()).toMatchObject({ amount: 1000, txnId: "DJVABC1234" });
    expect(posts.at(-1)?.text).toContain("Pot delivered: Yabets M received 1000 birr");
    expect((await call(KIBROM, "POST", url, { memberId })).json()).toEqual({ error: "already" });
  });
});

describe("A2: the ledger", () => {
  async function seasonWithATie() {
    await db.obligation.updateMany({
      where: { status: "due", gameweek: { fplEventId: 10 } },
      data: { status: "paid" },
    });
    const paid = await db.obligation.findMany({ where: { reason: "entry", gameweek: { fplEventId: 10 } } });
    for (const obligation of paid) {
      await db.payment.create({
        data: { obligationId: obligation.id, amount: 100, method: "manual", verifyStatus: "verified" },
      });
    }
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 }, [KINGS]: { points: 90 }, [NAT_FC]: { points: 90 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    await harness.tick(new Date("2026-11-10T12:00:00Z"));
    await harness.tick(new Date("2026-11-10T13:00:00Z"));
  }

  it("paid in, won and net match the sum of payments and payouts, with a 3-way tie and a free pass", async () => {
    await seasonWithATie();
    const { members, weeks } = (await call(ALICE, "GET", `/leagues/${leagueId}/ledger`)).json();

    expect(members.reduce((sum: number, row: { paidIn: number }) => sum + row.paidIn, 0)).toBe(1000);
    // 1,000 birr splits three ways, and 1 birr rolls over.
    expect(members.reduce((sum: number, row: { won: number }) => sum + row.won, 0)).toBe(999);
    expect((await db.gameweek.findFirstOrThrow({ where: { fplEventId: 11 } })).carryIn).toBe(1);

    const row = (name: string) => members.find((item: { manager: string }) => item.manager === name);
    expect(row("Yabets M")).toMatchObject({ paidIn: 100, won: 333, net: 233, received: 0 });
    expect(row("Ephrem T")).toMatchObject({ paidIn: 0, won: 0, net: 0 });
    expect(row("Natnael Malike")).toMatchObject({ paidIn: 100, won: 0, net: -100 });
    for (const item of members) expect(item.net).toBe(item.won - item.paidIn);

    const gw10 = weeks.filter((item: { gameweek: number }) => item.gameweek === 10);
    expect(gw10.reduce((sum: number, item: { paid: number }) => sum + item.paid, 0)).toBe(1000);
    expect(gw10.find((item: { manager: string }) => item.manager === "Ephrem T")).toMatchObject({
      reason: "free_pass",
      paid: 0,
    });
  });

  it("season stats come from the results, including a shared win", async () => {
    await seasonWithATie();
    const { stats } = (await call(ALICE, "GET", `/leagues/${leagueId}/ledger`)).json();
    const row = (name: string) => stats.find((item: { manager: string }) => item.manager === name);

    expect(row("Yabets M")).toMatchObject({ wins: 1, played: 1, biggestWin: 333, longestWinless: 0 });
    expect(row("Natnael Malike")).toMatchObject({ wins: 0, played: 1, longestWinless: 1 });
  });

  it("an early payment moved on as credit counts once, under the later gameweek", async () => {
    await db.obligation.updateMany({
      where: { status: "due", gameweek: { fplEventId: 10 } },
      data: { status: "paid" },
    });
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    await harness.tick(new Date("2026-11-07T12:00:00Z"));
    const early = await obligationOf(KINGS, 11);
    await db.obligation.update({ where: { id: early.id }, data: { status: "paid" } });
    await db.payment.create({
      data: { obligationId: early.id, amount: 100, method: "manual", verifyStatus: "verified" },
    });
    world.finished = { 10: {} };
    world.scores = { 10: { [JAZZ]: { points: 90 }, [KINGS]: { points: 80 } } };
    world.eventStatus = { status: [{ bonus_added: true, date: "x", event: 10, points: "r" }], leagues: "Updated" };
    await harness.tick(new Date("2026-11-10T12:00:00Z"));
    await harness.tick(new Date("2026-11-10T13:00:00Z"));

    const { members, weeks } = await leagueLedger(db, leagueId);
    expect(members.find((row) => row.manager === "KB Gselassie")?.paidIn).toBe(100);
    const kings = weeks.filter((row) => row.manager === "KB Gselassie" && row.paid > 0);
    expect(kings.map((row) => row.gameweek)).toEqual([12]);
  });

  it("only managers can export, and it arrives in their private chat", async () => {
    await seasonWithATie();
    expect((await call(ALICE, "GET", `/leagues/${leagueId}/ledger`)).json().canExport).toBe(false);
    expect((await call(KIBROM, "GET", `/leagues/${leagueId}/ledger`)).json().canExport).toBe(true);

    expect((await call(KIBROM, "POST", `/leagues/${leagueId}/ledger/send`)).statusCode).toBe(200);
    expect(documents[0]).toMatchObject({ chatId: BigInt(KIBROM.id), filename: "Office-ledger.csv" });
    expect(documents[0]?.content).toContain("Gameweek,Manager,Team");
    expect(documents[0]?.content).toContain("Season total,Yabets M,Jazz,,,100,333,0,233");
  });

  it("explains when it can't message them", async () => {
    documentsFail = true;
    const response = await call(KIBROM, "POST", `/leagues/${leagueId}/ledger/send`);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "cant_message_you" });
  });

  it("CSV quotes commas and quotes, and defuses spreadsheet formulas", () => {
    const row = {
      memberId: 1,
      manager: 'Abel "The Man"',
      team: "=HYPERLINK(1,2)",
      paidIn: 100,
      won: 0,
      received: 0,
      net: -100,
    };
    const csv = ledgerCsv({
      members: [row, { ...row, team: "Red, White" }, { ...row, team: "+SUM(1)" }, { ...row, team: "@cmd" }],
      weeks: [],
      stats: [],
    });

    expect(csv).toContain('"Abel ""The Man"""');
    expect(csv).toContain(`"'=HYPERLINK(1,2)"`);
    expect(csv).toContain('"Red, White"');
    expect(csv).toContain("'+SUM(1)");
    expect(csv).toContain("'@cmd");
  });
});

describe("members", () => {
  const urlFor = (id: number, end: string) => `/leagues/${leagueId}/members/${id}/${end}`;

  it("lists who claimed what", async () => {
    const { members } = (await call(KIBROM, "GET", `/leagues/${leagueId}/members`)).json();
    const jazz = members.find((item: { team: string }) => item.team === "Jazz");

    expect(jazz).toMatchObject({ manager: "Yabets M", claimedBy: "Alice", status: "active", entry: JAZZ });
    expect(members.find((item: { team: string }) => item.team === "kings").claimedBy).toBeNull();
  });

  it("unlinks, logged, and refuses someone unlinked", async () => {
    const jazz = await memberOf(JAZZ);
    expect((await call(OWNER, "POST", urlFor(jazz.id, "unlink"))).statusCode).toBe(200);

    expect((await memberOf(JAZZ)).userId).toBeNull();
    expect(await db.auditLog.count({ where: { action: "member.unlink" } })).toBe(1);
    expect((await call(OWNER, "POST", urlFor(jazz.id, "unlink"))).json()).toEqual({ error: "not_linked" });
  });

  it("pausing is logged and leaves money alone, and stops next gameweek's fee", async () => {
    const jazz = await memberOf(JAZZ);
    expect((await call(KIBROM, "POST", urlFor(jazz.id, "status"), { status: "paused" })).statusCode).toBe(200);

    expect((await memberOf(JAZZ)).status).toBe("paused");
    expect((await obligationOf(JAZZ)).status).toBe("due");
    expect(await db.auditLog.count({ where: { action: "member.status" } })).toBe(1);

    await harness.tick(new Date("2026-11-07T12:00:00Z"));
    expect(await db.obligation.count({ where: { memberId: jazz.id, gameweek: { fplEventId: 11 } } })).toBe(0);
  });

  it("refuses a status of left, which only FPL decides, and someone who left", async () => {
    const jazz = await memberOf(JAZZ);
    expect((await call(KIBROM, "POST", urlFor(jazz.id, "status"), { status: "left" })).statusCode).toBe(400);

    await db.member.update({ where: { id: jazz.id }, data: { status: "left" } });
    expect((await call(KIBROM, "POST", urlFor(jazz.id, "status"), { status: "active" })).json()).toEqual({
      error: "member_left",
    });
  });

  it("adds and deletes facts, logged, and respects /nofun", async () => {
    const jazz = await memberOf(JAZZ);
    expect((await call(KIBROM, "POST", urlFor(jazz.id, "facts"), { fact: "loves Arsenal" })).statusCode).toBe(200);
    const fact = await db.memberFact.findFirstOrThrow();
    expect(fact.fact).toBe("loves Arsenal");

    expect((await call(KIBROM, "DELETE", urlFor(jazz.id, `facts/${fact.id}`))).statusCode).toBe(200);
    expect(await db.memberFact.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: { in: ["fact.add", "fact.delete"] } } })).toBe(2);

    await db.member.update({ where: { id: jazz.id }, data: { roastOptOut: true } });
    expect((await call(KIBROM, "POST", urlFor(jazz.id, "facts"), { fact: "x" })).json()).toEqual({
      error: "opted_out",
    });
  });
});

describe("rules", () => {
  it("shows settings and choices to managers", async () => {
    const data = (await call(KIBROM, "GET", `/leagues/${leagueId}/rules`)).json();

    expect(data.role).toBe("coordinator");
    expect(data.rules.entryFee).toBe(100);
    expect(data.options.scoreMode).toEqual(["net", "gross"]);
    expect(data.persona).toMatchObject({ name: "commentator", language: "en" });
  });

  it("the owner can change a rule, logged, and a bad value is refused", async () => {
    const url = `/leagues/${leagueId}/rules`;
    expect((await call(OWNER, "POST", url, { key: "scoreMode", value: "gross" })).statusCode).toBe(200);
    expect((await db.league.findFirstOrThrow()).rules).toMatchObject({ scoreMode: "gross" });
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "rules.update" } })).toMatchObject({
      before: { scoreMode: "net" },
      after: { scoreMode: "gross" },
    });

    const bad = await call(OWNER, "POST", url, { key: "entryFee", value: "abc" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: "bad_rule" });
  });

  it("the coordinator can set the Telebirr name; the owner sets the persona and coordinator", async () => {
    await call(KIBROM, "POST", `/leagues/${leagueId}/telebirr`, { name: "Kibrom" });
    expect((await db.league.findFirstOrThrow()).coordinatorTelebirrName).toBe("Kibrom");

    await call(OWNER, "POST", `/leagues/${leagueId}/persona`, { name: "pundit", spice: 4 });
    expect((await db.league.findFirstOrThrow()).persona).toMatchObject({ name: "pundit", spice: 4 });
    const bad = await call(OWNER, "POST", `/leagues/${leagueId}/persona`, { name: "wizard", spice: 9 });
    expect(bad.statusCode).toBe(400);

    const jazz = await memberOf(JAZZ);
    await call(OWNER, "POST", `/leagues/${leagueId}/coordinator`, { memberId: jazz.id });
    expect((await db.league.findFirstOrThrow()).coordinatorUserId).toBe(jazz.userId);

    const kings = await memberOf(KINGS);
    const unclaimed = await call(OWNER, "POST", `/leagues/${leagueId}/coordinator`, { memberId: kings.id });
    expect(unclaimed.json()).toEqual({ error: "not_linked" });
  });
});

describe("A3: the audit log", () => {
  it("shows who, what and when, newest first, for changes from the bot and the app", async () => {
    await harness.say(OWNER, GROUP_ID, "/settelebirr Kibrom");
    const memberId = (await memberOf(KINGS)).id;
    await call(KIBROM, "POST", `/leagues/${leagueId}/payments/mark`, { memberId, gameweek: 10, paid: true });

    const { entries, timezone } = (await call(KIBROM, "GET", `/leagues/${leagueId}/audit`)).json();
    expect(timezone).toBe("Africa/Addis_Ababa");
    expect(entries[0]).toMatchObject({
      actor: "Kibrom",
      action: "payment.mark_paid",
      before: { status: "due" },
      after: { status: "paid" },
    });
    expect(entries[0].at).toEqual(expect.any(String));
    expect(entries[0].subject).toBe("KB Gselassie, GW10");
    expect(entries.map((entry: { action: string }) => entry.action)).toContain("telebirr.set_receiver");
    expect(entries.map((entry: { action: string }) => entry.action)).toContain("coordinator.set");
  });
});

describe("A3: names instead of IDs", () => {
  const latest = async () => (await call(OWNER, "GET", `/leagues/${leagueId}/audit`)).json().entries[0];

  it("names the coordinator, not their ID", async () => {
    const entry = (await call(OWNER, "GET", `/leagues/${leagueId}/audit`)).json().entries.at(-1);

    expect(entry).toMatchObject({ action: "coordinator.set", after: { coordinator: "Kibrom" } });
    expect(entry.after.coordinatorUserId).toBeUndefined();
  });

  it("names who a reviewed payment was from", async () => {
    const obligation = await obligationOf(JAZZ);
    const payment = await db.payment.create({
      data: { obligationId: obligation.id, amount: 100, method: "screenshot", verifyStatus: "needs_review" },
    });
    await call(KIBROM, "POST", `/leagues/${leagueId}/payments/${payment.id}/decide`, { approve: true });

    expect(await latest()).toMatchObject({ action: "payment.approve", subject: "Yabets M, GW10", actor: "Kibrom" });
  });

  it("names winners and the gameweek on a hand-set result", async () => {
    await harness.tick(new Date("2026-11-06T18:30:00Z"));
    const jazz = await memberOf(JAZZ);
    await call(OWNER, "POST", `/leagues/${leagueId}/results/10/winner`, { winnerIds: [jazz.id] });

    expect(await latest()).toMatchObject({
      action: "result.override",
      subject: "GW10",
      after: { winners: "Yabets M", runnersUp: "" },
    });
  });

  it("names who a score and a status change were for", async () => {
    const kings = await memberOf(KINGS);
    await call(OWNER, "POST", `/leagues/${leagueId}/members/${kings.id}/status`, { status: "paused" });
    expect(await latest()).toMatchObject({ subject: "KB Gselassie", after: { status: "paused" } });

    await call(OWNER, "POST", `/leagues/${leagueId}/results/10/score`, { memberId: kings.id, points: 50 });
    expect(await latest()).toMatchObject({ action: "score.override", subject: "KB Gselassie" });
  });

  it("still shows an entry whose subject has gone", async () => {
    const fact = await db.memberFact.create({
      data: { memberId: (await memberOf(JAZZ)).id, fact: "x", source: "admin" },
    });
    const jazz = await memberOf(JAZZ);
    await call(OWNER, "DELETE", `/leagues/${leagueId}/members/${jazz.id}/facts/${fact.id}`);

    expect(await latest()).toMatchObject({ action: "fact.delete", before: { member: "Yabets M" } });
  });
});

describe("results and the score rule", () => {
  it("shows scores before hits when the league scores that way", async () => {
    await db.league.update({ where: { id: leagueId }, data: { rules: { scoreMode: "gross" } } });
    const gameweek = await db.gameweek.findFirstOrThrow({ where: { fplEventId: 10 } });
    await db.gameweek.update({ where: { id: gameweek.id }, data: { status: "locked" } });
    await db.score.create({
      data: {
        gameweekId: gameweek.id,
        memberId: (await memberOf(JAZZ)).id,
        points: 60,
        transferCost: 8,
        benchPoints: 0,
      },
    });

    const { gameweeks } = (await call(ALICE, "GET", `/leagues/${leagueId}/results`)).json();
    expect(gameweeks[0].scores[0]).toMatchObject({ points: 60, transferCost: 8, net: 60 });
  });
});

describe("unexpected errors", () => {
  it("doesn't leak details", async () => {
    const response = await api.inject({
      method: "POST",
      url: `/api/leagues/${leagueId}/telebirr`,
      headers: {
        authorization: `tma ${signInitData(KIBROM, TOKEN, NOW)}`,
        "content-type": "application/json",
      },
      payload: "{not json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "bad_request" });
  });
});
