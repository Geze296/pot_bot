import { parseRules, RULE_OPTIONS, RuleError, setRule, type LeagueRules } from "@potbot/core";
import type { League, Member, PrismaClient } from "@potbot/db";
import type { FplClient } from "@potbot/fpl";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { t } from "../i18n/index.js";
import { personaSettings, PERSONAS, type PersonaName } from "../services/banter.js";
import { leagueLedger, ledgerCsv } from "../services/ledger.js";
import { createLiveTables } from "../services/live-table.js";
import { SETUP_STATE } from "../services/league-setup.js";
import { decideReview, markPaid, markUnpaid, type ScreenshotRef } from "../services/payments.js";
import { recordPayout, type Share } from "../services/payouts.js";
import { leagueStatus } from "../services/reminders.js";
import { ensureObligations, overrideScore, overrideWinner, type SendOptions } from "../services/settlement.js";
import { ensureUser } from "../services/users.js";
import { auditNames } from "./audit-names.js";
import { verifyInitData } from "./auth.js";

export type Role = "owner" | "coordinator" | "member";

export interface RouteDeps {
  db: PrismaClient;
  fpl: FplClient;
  botToken: string;
  send: (chatId: bigint, text: string, options?: SendOptions) => Promise<unknown>;
  sendDocument: (chatId: bigint, filename: string, content: string) => Promise<unknown>;
  sendScreenshot: (chatId: bigint, screenshot: ScreenshotRef, caption: string) => Promise<unknown>;
  now?: () => Date;
}

/** Carries a code the app turns into a message. The wording lives in the locale file (hard rule 9). */
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const badRequest = () => new ApiError(400, "bad_request");

function wholeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw badRequest();
  return value;
}

function paramNumber(value: string): number {
  if (!/^\d+$/.test(value)) throw new ApiError(404, "not_found");
  return Number(value);
}

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) throw badRequest();
  return value.trim();
}

const body = (request: FastifyRequest) => (request.body ?? {}) as Record<string, unknown>;

export function roleIn(league: League, userId: number, isMember: boolean): Role | null {
  if (league.ownerUserId === userId) return "owner";
  if (league.coordinatorUserId === userId) return "coordinator";
  return isMember ? "member" : null;
}

export function apiRoutes(deps: RouteDeps) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const liveTable = createLiveTables(db, deps.fpl, () => now().getTime());

  return async function routes(api: FastifyInstance): Promise<void> {
    api.setErrorHandler((error, _request, reply: FastifyReply) => {
      if (error instanceof ApiError) return reply.code(error.status).send({ error: error.code });
      const status = (error as { statusCode?: number }).statusCode;
      if (status && status < 500) return reply.code(status).send({ error: "bad_request" });
      console.error("API error:", error);
      return reply.code(500).send({ error: "server_error" });
    });

    /** Who is asking, from Telegram's signature. Every route goes through this first. */
    async function currentUser(request: FastifyRequest) {
      const header = request.headers.authorization ?? "";
      const initData = header.startsWith("tma ") ? header.slice(4) : "";
      const person = verifyInitData(initData, deps.botToken, now());
      if (!person) throw new ApiError(401, "unauthorized");
      return ensureUser(db, person);
    }

    /** The league and the caller's role in it. A league they aren't part of looks the same as one that's missing. */
    async function access(request: FastifyRequest, allowed: Role[] = ["owner", "coordinator", "member"]) {
      const user = await currentUser(request);
      const { leagueId } = request.params as { leagueId: string };
      const league = await db.league.findUnique({ where: { id: paramNumber(leagueId) } });
      if (!league || league.setupState !== SETUP_STATE.active) throw new ApiError(403, "forbidden");

      const member = await db.member.findFirst({ where: { leagueId: league.id, userId: user.id } });
      const role = roleIn(league, user.id, member !== null);
      if (!role || !allowed.includes(role)) throw new ApiError(403, "forbidden");
      return { user, league, role, member };
    }
    const MANAGERS: Role[] = ["owner", "coordinator"];
    const OWNER: Role[] = ["owner"];

    async function memberIn(league: League, value: unknown): Promise<Member> {
      const member = await db.member.findFirst({ where: { id: wholeNumber(value), leagueId: league.id } });
      if (!member) throw new ApiError(404, "not_found");
      return member;
    }

    async function gameweekIn(league: League, value: string) {
      const gameweek = await db.gameweek.findUnique({
        where: { leagueId_fplEventId: { leagueId: league.id, fplEventId: paramNumber(value) } },
      });
      if (!gameweek) throw new ApiError(404, "not_found");
      return gameweek;
    }

    /** Fees may not exist yet if the 15-minute job hasn't run since the window opened. */
    async function openGameweek(league: League) {
      const open = await db.gameweek.findFirst({
        where: { leagueId: league.id, status: "open", paymentOpensAt: { lte: now() } },
        orderBy: { fplEventId: "asc" },
      });
      if (open) await db.$transaction((tx) => ensureObligations(tx, league, open));
      return open;
    }

    const audit = (
      league: League,
      actorId: number,
      action: string,
      entity: string,
      entityId: number,
      before: object,
      after: object,
    ) => db.auditLog.create({ data: { leagueId: league.id, actorId, action, entity, entityId, before, after } });

    // Announcements mustn't undo what was already saved if Telegram fails.
    async function tell(chatId: bigint | undefined, message: string) {
      if (chatId === undefined) return;
      try {
        await deps.send(chatId, message);
      } catch (error) {
        console.error("Couldn't send a message from the app:", error);
      }
    }

    api.get("/me", async (request) => {
      const user = await currentUser(request);
      const leagues = await db.league.findMany({
        where: {
          setupState: SETUP_STATE.active,
          OR: [{ ownerUserId: user.id }, { coordinatorUserId: user.id }, { members: { some: { userId: user.id } } }],
        },
        include: { members: { where: { userId: user.id } } },
        orderBy: { id: "asc" },
      });
      return {
        name: user.displayName,
        leagues: leagues.map((league) => ({
          id: league.id,
          name: league.name,
          role: roleIn(league, user.id, league.members.length > 0),
        })),
      };
    });

    api.get("/leagues/:leagueId/dashboard", async (request) => {
      const { league, member, role } = await access(request);
      await openGameweek(league);
      const status = await leagueStatus(db, league);

      const latest = await db.gameweek.findFirst({
        where: { leagueId: league.id, status: "settled", result: { isNot: null } },
        include: { result: true },
        orderBy: { fplEventId: "desc" },
      });
      const members = await db.member.findMany({ where: { leagueId: league.id } });
      const nameOf = (id: number) => members.find((item) => item.id === id)?.fplManagerName ?? "";
      const yours =
        status && member
          ? await db.obligation.findFirst({ where: { gameweekId: status.gameweek.id, memberId: member.id } })
          : null;

      const yourReviews = yours
        ? await db.payment.count({ where: { obligationId: yours.id, verifyStatus: "needs_review" } })
        : 0;

      return {
        role,
        timezone: league.timezone,
        team: member?.fplTeamName ?? null,
        yourStatus: yours ? { status: yours.status, reason: yours.reason, amountDue: yours.amountDue } : null,
        yourPaymentInReview: yourReviews > 0,
        receiver: league.coordinatorTelebirrName,
        gameweek: status
          ? {
              event: status.gameweek.fplEventId,
              deadlineAt: status.gameweek.deadlineAt,
              status: status.gameweek.status,
            }
          : null,
        pot: status?.pot ?? 0,
        paid: status?.paid ?? [],
        freePass: status?.freePass ?? [],
        inReview: status?.inReview ?? [],
        unpaid: status?.unpaid ?? [],
        out: status?.out ?? [],
        lastResult: latest?.result
          ? { event: latest.fplEventId, winners: latest.result.winnerMemberIds.map(nameOf) }
          : null,
      };
    });

    api.get("/leagues/:leagueId/table", async (request) => {
      const { league, member } = await access(request);
      try {
        return { yourTeam: member?.fplTeamName ?? null, table: await liveTable(league) };
      } catch (error) {
        console.error("Couldn't build the live table:", error);
        throw new ApiError(503, "fpl_down");
      }
    });

    api.get("/leagues/:leagueId/payments", async (request) => {
      const { league } = await access(request, MANAGERS);
      const open = await openGameweek(league);
      const gameweek =
        open ??
        (await db.gameweek.findFirst({
          where: { leagueId: league.id, status: "locked" },
          orderBy: { fplEventId: "desc" },
        }));

      const reviews = await db.payment.findMany({
        where: { verifyStatus: "needs_review", obligation: { gameweek: { leagueId: league.id } } },
        include: { obligation: { include: { member: true, gameweek: true } } },
        orderBy: { createdAt: "asc" },
      });
      const obligations = gameweek
        ? await db.obligation.findMany({
            where: { gameweekId: gameweek.id },
            include: { member: true },
            orderBy: { member: { fplManagerName: "asc" } },
          })
        : [];

      return {
        timezone: league.timezone,
        gameweek: gameweek ? { event: gameweek.fplEventId, status: gameweek.status } : null,
        reviews: reviews.map((payment) => ({
          id: payment.id,
          manager: payment.obligation.member.fplManagerName,
          team: payment.obligation.member.fplTeamName,
          gameweek: payment.obligation.gameweek.fplEventId,
          reason: payment.verifyReason,
          txnId: payment.txnId,
          paidAt: payment.paidAt,
          hasScreenshot: payment.screenshotFileId !== null,
        })),
        members: obligations.map((item) => ({
          isCollector: item.member.userId !== null && item.member.userId === league.coordinatorUserId,
          memberId: item.memberId,
          manager: item.member.fplManagerName,
          team: item.member.fplTeamName,
          status: item.status,
          reason: item.reason,
          amountDue: item.amountDue,
        })),
      };
    });

    api.post("/leagues/:leagueId/payments/:paymentId/decide", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const paymentId = paramNumber((request.params as { paymentId: string }).paymentId);
      const approve = body(request).approve;
      if (typeof approve !== "boolean") throw badRequest();

      const inLeague = await db.payment.findFirst({
        where: { id: paymentId, obligation: { gameweek: { leagueId: league.id } } },
      });
      if (!inLeague) throw new ApiError(404, "not_found");

      const outcome = await decideReview(db, { paymentId, actorId: user.id, approve });
      if (!outcome) throw new ApiError(409, "already_decided");

      const { member, gameweek, pot } = outcome;
      const owner = member.userId ? await db.user.findUnique({ where: { id: member.userId } }) : null;
      await tell(
        owner?.telegramId,
        t("en", approve ? "review.memberApproved" : "review.memberRejected", { gw: gameweek }),
      );
      if (approve) {
        await tell(
          league.telegramChatId,
          t("en", "payments.paidGroup", { name: member.fplManagerName, gw: gameweek, pot }),
        );
      }
      return { ok: true };
    });

    api.post("/leagues/:leagueId/payments/:paymentId/screenshot", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const paymentId = paramNumber((request.params as { paymentId: string }).paymentId);
      const payment = await db.payment.findFirst({
        where: { id: paymentId, obligation: { gameweek: { leagueId: league.id } } },
        include: { obligation: { include: { member: true, gameweek: true } } },
      });
      if (!payment) throw new ApiError(404, "not_found");
      if (!payment.screenshotFileId) throw new ApiError(409, "no_screenshot");

      const caption = t("en", "review.screenshotCaption", {
        name: payment.obligation.member.fplManagerName,
        gw: payment.obligation.gameweek.fplEventId,
      });
      try {
        await deps.sendScreenshot(
          user.telegramId,
          { fileId: payment.screenshotFileId, isPhoto: payment.screenshotIsPhoto ?? true },
          caption,
        );
      } catch (error) {
        console.error("Couldn't send a screenshot:", error);
        throw new ApiError(409, "cant_message_you");
      }
      return { ok: true };
    });

    api.post("/leagues/:leagueId/payments/mark", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const data = body(request);
      const member = await memberIn(league, data.memberId);
      const gameweek = await gameweekIn(league, String(wholeNumber(data.gameweek)));
      if (typeof data.paid !== "boolean") throw badRequest();

      const result = data.paid
        ? await markPaid(db, { league, member, gameweek, actorId: user.id, now: now() })
        : await markUnpaid(db, { league, member, gameweek, actorId: user.id });
      if (result !== "done") throw new ApiError(409, result);
      return { ok: true };
    });

    api.get("/leagues/:leagueId/results", async (request) => {
      const { league } = await access(request);
      const gameweeks = await db.gameweek.findMany({
        where: { leagueId: league.id, status: { in: ["locked", "settled", "finished"] } },
        include: { result: { include: { payouts: true } }, scores: { include: { member: true } } },
        orderBy: { fplEventId: "desc" },
      });
      const members = await db.member.findMany({ where: { leagueId: league.id } });
      const member = (id: number) => members.find((item) => item.id === id);
      const { scoreMode } = parseRules(league.rules);

      return {
        gameweeks: gameweeks.map((gameweek) => ({
          event: gameweek.fplEventId,
          status: gameweek.status,
          pot: gameweek.potAmount,
          result: gameweek.result
            ? {
                source: gameweek.result.source,
                winners: gameweek.result.winnerMemberIds.map((id) => member(id)?.fplManagerName ?? ""),
                runnersUp: gameweek.result.runnerUpMemberIds.map((id) => member(id)?.fplManagerName ?? ""),
                carryOut: gameweek.result.carryOut,
                shares: ((gameweek.result.payoutShares ?? []) as unknown as Share[]).map((share) => {
                  const payout = gameweek.result?.payouts.find((item) => item.memberId === share.memberId);
                  return {
                    memberId: share.memberId,
                    manager: member(share.memberId)?.fplManagerName ?? "",
                    amount: share.amount,
                    paid: payout !== undefined,
                    txnId: payout?.txnId ?? null,
                  };
                }),
              }
            : null,
          scores: gameweek.scores
            .map((score) => ({
              memberId: score.memberId,
              manager: score.member.fplManagerName,
              team: score.member.fplTeamName,
              points: score.points,
              transferCost: score.transferCost,
              net: scoreMode === "gross" ? score.points : score.points - score.transferCost,
              rank: score.rankInGw,
              source: score.source,
            }))
            .sort((a, b) => b.net - a.net),
        })),
        members: members
          .filter((item) => item.status !== "left")
          .map((item) => ({ memberId: item.id, manager: item.fplManagerName, team: item.fplTeamName })),
      };
    });

    api.post("/leagues/:leagueId/results/:event/score", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const gameweek = await gameweekIn(league, (request.params as { event: string }).event);
      const data = body(request);
      const member = await memberIn(league, data.memberId);
      const points = wholeNumber(data.points);
      const transferCost = wholeNumber(data.transferCost ?? 0);

      await overrideScore(
        { db, send: deps.send },
        { league, gameweek, member, points, transferCost, actorId: user.id },
      );
      return { ok: true };
    });

    api.post("/leagues/:leagueId/results/:event/winner", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const gameweek = await gameweekIn(league, (request.params as { event: string }).event);
      if (gameweek.status === "open") throw new ApiError(409, "not_started");

      const data = body(request);
      if (!Array.isArray(data.winnerIds) || data.winnerIds.length === 0) throw badRequest();
      const runnerUpIds = Array.isArray(data.runnerUpIds) ? data.runnerUpIds : [];
      const winners = await Promise.all(data.winnerIds.map((id) => memberIn(league, id)));
      const runners = await Promise.all(runnerUpIds.map((id) => memberIn(league, id)));

      await overrideWinner(
        { db, send: deps.send },
        {
          league,
          gameweek,
          winnerIds: winners.map((item) => item.id),
          runnerUpIds: runners.map((item) => item.id),
          actorId: user.id,
        },
      );
      return { ok: true };
    });

    api.post("/leagues/:leagueId/results/:event/payout", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const gameweek = await gameweekIn(league, (request.params as { event: string }).event);
      const data = body(request);
      const member = await memberIn(league, data.memberId);

      const txnId = data.txnId === undefined || data.txnId === "" ? undefined : text(data.txnId, 20).toUpperCase();
      if (txnId !== undefined && !/^[A-Z0-9]{6,20}$/.test(txnId)) throw badRequest();

      const result = await recordPayout(db, {
        gameweekId: gameweek.id,
        memberId: member.id,
        ...(txnId ? { txnId } : {}),
        actorId: user.id,
        leagueId: league.id,
        now: now(),
      });
      if (result.kind !== "done") throw new ApiError(409, result.kind);

      await tell(
        league.telegramChatId,
        t("en", "payout.delivered", {
          name: result.member.fplManagerName,
          amount: result.amount,
          gw: gameweek.fplEventId,
        }),
      );
      return { ok: true };
    });

    api.get("/leagues/:leagueId/ledger", async (request) => {
      const { league, role } = await access(request);
      return { ...(await leagueLedger(db, league.id)), canExport: role !== "member" };
    });

    api.post("/leagues/:leagueId/ledger/send", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const csv = ledgerCsv(await leagueLedger(db, league.id));
      try {
        await deps.sendDocument(user.telegramId, `${league.name}-ledger.csv`, csv);
      } catch (error) {
        console.error("Couldn't send the ledger:", error);
        // Usually they never pressed Start, which is something the app can tell them.
        throw new ApiError(409, "cant_message_you");
      }
      return { ok: true };
    });

    api.get("/leagues/:leagueId/members", async (request) => {
      const { league } = await access(request, MANAGERS);
      const members = await db.member.findMany({
        where: { leagueId: league.id },
        include: { user: true, facts: { orderBy: { createdAt: "asc" } } },
        orderBy: { fplManagerName: "asc" },
      });
      return {
        coordinatorUserId: league.coordinatorUserId,
        ownerUserId: league.ownerUserId,
        members: members.map((member) => ({
          id: member.id,
          entry: member.fplEntryId,
          manager: member.fplManagerName,
          team: member.fplTeamName,
          status: member.status,
          roastOptOut: member.roastOptOut,
          userId: member.userId,
          claimedBy: member.user?.displayName ?? null,
          username: member.user?.username ?? null,
          facts: member.facts.map((fact) => ({ id: fact.id, fact: fact.fact })),
        })),
      };
    });

    async function memberParam(request: FastifyRequest, league: League) {
      return memberIn(league, paramNumber((request.params as { memberId: string }).memberId));
    }

    api.post("/leagues/:leagueId/members/:memberId/unlink", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const member = await memberParam(request, league);
      if (member.userId === null) throw new ApiError(409, "not_linked");

      await db.member.update({ where: { id: member.id }, data: { userId: null } });
      await audit(league, user.id, "member.unlink", "member", member.id, { userId: member.userId }, { userId: null });
      return { ok: true };
    });

    // Takes effect from the next gameweek's fees. What's already owed or paid stays, so no money moves here.
    api.post("/leagues/:leagueId/members/:memberId/status", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const member = await memberParam(request, league);
      const status = body(request).status;
      if (status !== "active" && status !== "paused") throw badRequest();
      if (member.status === "left") throw new ApiError(409, "member_left");

      await db.member.update({ where: { id: member.id }, data: { status } });
      await audit(league, user.id, "member.status", "member", member.id, { status: member.status }, { status });
      return { ok: true };
    });

    api.post("/leagues/:leagueId/members/:memberId/facts", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const member = await memberParam(request, league);
      if (member.roastOptOut) throw new ApiError(409, "opted_out");

      const fact = text(body(request).fact, 300);
      const saved = await db.memberFact.create({ data: { memberId: member.id, fact, source: "admin" } });
      await audit(league, user.id, "fact.add", "member_fact", saved.id, {}, { memberId: member.id });
      return { ok: true };
    });

    api.delete("/leagues/:leagueId/members/:memberId/facts/:factId", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const member = await memberParam(request, league);
      const factId = paramNumber((request.params as { factId: string }).factId);

      const { count } = await db.memberFact.deleteMany({ where: { id: factId, memberId: member.id } });
      if (count === 0) throw new ApiError(404, "not_found");
      await audit(league, user.id, "fact.delete", "member_fact", factId, { memberId: member.id }, {});
      return { ok: true };
    });

    api.post("/leagues/:leagueId/coordinator", async (request) => {
      const { league, user } = await access(request, OWNER);
      const member = await memberIn(league, body(request).memberId);
      if (member.userId === null) throw new ApiError(409, "not_linked");

      await db.league.update({ where: { id: league.id }, data: { coordinatorUserId: member.userId } });
      await audit(
        league,
        user.id,
        "coordinator.set",
        "league",
        league.id,
        { coordinatorUserId: league.coordinatorUserId },
        { coordinatorUserId: member.userId },
      );
      return { ok: true };
    });

    api.get("/leagues/:leagueId/rules", async (request) => {
      const { league, role } = await access(request, MANAGERS);
      return {
        role,
        rules: parseRules(league.rules),
        options: RULE_OPTIONS,
        telebirrName: league.coordinatorTelebirrName,
        persona: personaSettings(league),
        personas: PERSONAS,
      };
    });

    api.post("/leagues/:leagueId/rules", async (request) => {
      const { league, user } = await access(request, OWNER);
      const key = text(body(request).key, 40);
      const value = text(body(request).value, 40);

      const before = parseRules(league.rules);
      let after: LeagueRules;
      try {
        after = setRule(before, key, value);
      } catch (error) {
        if (error instanceof RuleError) throw new ApiError(400, "bad_rule");
        throw error;
      }
      await db.league.update({ where: { id: league.id }, data: { rules: { ...after } } });
      await audit(
        league,
        user.id,
        "rules.update",
        "league",
        league.id,
        { [key]: before[key as keyof LeagueRules] },
        { [key]: after[key as keyof LeagueRules] },
      );
      return { ok: true };
    });

    api.post("/leagues/:leagueId/telebirr", async (request) => {
      const { league, user } = await access(request, MANAGERS);
      const name = text(body(request).name, 100);
      await db.league.update({ where: { id: league.id }, data: { coordinatorTelebirrName: name } });
      await audit(
        league,
        user.id,
        "telebirr.set_receiver",
        "league",
        league.id,
        { name: league.coordinatorTelebirrName },
        { name },
      );
      return { ok: true };
    });

    api.post("/leagues/:leagueId/persona", async (request) => {
      const { league, user } = await access(request, OWNER);
      const data = body(request);
      const current = personaSettings(league);
      const spice = wholeNumber(data.spice);
      if (!PERSONAS.includes(data.name as PersonaName) || spice < 1 || spice > 5) throw badRequest();

      const updated = { ...current, name: data.name as PersonaName, spice };
      await db.league.update({ where: { id: league.id }, data: { persona: { ...updated } } });
      await audit(league, user.id, "persona.update", "league", league.id, { ...current }, { ...updated });
      return { ok: true };
    });

    api.get("/leagues/:leagueId/audit", async (request) => {
      const { league } = await access(request, MANAGERS);
      const entries = await db.auditLog.findMany({
        where: { leagueId: league.id },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const describe = await auditNames(db, league.id, entries);
      return {
        timezone: league.timezone,
        entries: entries.map((entry) => ({
          id: entry.id,
          at: entry.createdAt,
          actor: describe.userName(entry.actorId),
          action: entry.action,
          subject: describe.subject(entry),
          before: describe.values(entry.before),
          after: describe.values(entry.after),
        })),
      };
    });
  };
}
