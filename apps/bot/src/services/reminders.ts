import { currentReminderRound, potFromObligations, type ReminderRound } from "@potbot/core";
import type { Gameweek, League, Member, PrismaClient, User } from "@potbot/db";
import { formatTimeLeft } from "../i18n/format.js";
import { t, type Language, type MessageKey } from "../i18n/index.js";
import { claimMessage, releaseMessage } from "./message-log.js";
import type { SettlementDeps } from "./settlement.js";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Who to call out in a group message. Someone with no username is mentioned through a link to their account, which
 * notifies them just the same. A manager who hasn't claimed a team can only be named by team.
 */
export function mentionFor(member: Member & { user: User | null }): string {
  const { user } = member;
  if (!user) return escapeHtml(member.fplTeamName);
  if (user.username) return `@${user.username}`;
  return `<a href="tg://user?id=${user.telegramId}">${escapeHtml(user.displayName)}</a>`;
}

const languageOf = (user: User): Language => (user.language === "am" ? "am" : "en");

async function sendRound(deps: SettlementDeps, league: League, gameweek: Gameweek, round: ReminderRound, now: Date) {
  const { db, send } = deps;
  const obligations = await db.obligation.findMany({
    where: { gameweekId: gameweek.id, status: "due" },
    include: { member: { include: { user: true } }, payments: true },
    orderBy: { memberId: "asc" },
  });
  // Someone waiting on the coordinator has done their part, so they aren't chased.
  const unpaid = obligations.filter(
    (item) => !item.payments.some((payment) => ["pending", "needs_review"].includes(payment.verifyStatus)),
  );
  if (unpaid.length === 0) return;

  const gw = gameweek.fplEventId;
  const msLeft = gameweek.deadlineAt.getTime() - now.getTime();

  const groupKey = `reminder:gw${gw}:${round.key}:group`;
  if (await claimMessage(db, league.id, groupKey, "reminder")) {
    const names = unpaid.map((item) => mentionFor(item.member)).join(", ");
    const text = t("en", `reminder.group.${round.tone}` as MessageKey, {
      gw,
      names,
      left: formatTimeLeft("en", msLeft),
    });
    try {
      await send(league.telegramChatId, text, { parse_mode: "HTML" });
    } catch (error) {
      await releaseMessage(db, league.id, groupKey);
      throw error;
    }
  }

  for (const { member, amountDue } of unpaid) {
    const { user } = member;
    if (!user) continue;
    const key = `reminder:gw${gw}:${round.key}:member${member.id}`;
    if (!(await claimMessage(db, league.id, key, "reminder"))) continue;

    const language = languageOf(user);
    const text = t(language, `reminder.private.${round.tone}` as MessageKey, {
      gw,
      fee: amountDue,
      left: formatTimeLeft(language, msLeft),
      receiver: league.coordinatorTelebirrName ?? t(language, "reminder.theCoordinator"),
    });
    try {
      await send(user.telegramId, text);
    } catch (error) {
      // Usually they never pressed Start. They still get the group mention, so this isn't retried.
      console.error(`Couldn't send a private reminder to member ${member.id}:`, error);
    }
  }
}

export async function sendReminders(deps: SettlementDeps, league: League, now: Date): Promise<void> {
  const gameweeks = await deps.db.gameweek.findMany({
    where: { leagueId: league.id, status: "open", paymentOpensAt: { lte: now }, deadlineAt: { gt: now } },
    orderBy: { fplEventId: "asc" },
  });
  for (const gameweek of gameweeks) {
    const round = currentReminderRound(gameweek.deadlineAt, now);
    if (round) await sendRound(deps, league, gameweek, round, now);
  }
}

/** Tells the group who is in, once, after each deadline. A failed send is retried on the next tick. */
export async function postDeadlineMessages(deps: SettlementDeps, league: League): Promise<void> {
  const { db, send } = deps;
  const locked = await db.gameweek.findMany({
    where: { leagueId: league.id, status: "locked" },
    orderBy: { fplEventId: "asc" },
  });

  for (const gameweek of locked) {
    const gw = gameweek.fplEventId;
    const key = `deadline:gw${gw}`;
    if (!(await claimMessage(db, league.id, key, "deadline"))) continue;

    const obligations = await db.obligation.findMany({
      where: { gameweekId: gameweek.id },
      include: { member: true, payments: true },
      orderBy: { memberId: "asc" },
    });
    const playing = obligations.filter((item) => item.status === "paid");
    const inReview = obligations.filter(
      (item) => item.status !== "paid" && item.payments.some((payment) => payment.verifyStatus === "needs_review"),
    );

    const names = playing.map((item) =>
      item.reason === "free_pass"
        ? t("en", "deadline.freePassName", { name: item.member.fplManagerName })
        : item.member.fplManagerName,
    );
    const lines = [t("en", "deadline.header", { gw })];
    lines.push(
      names.length > 0
        ? t("en", "deadline.participants", { count: names.length, names: names.join(", ") })
        : t("en", "deadline.nobody"),
    );
    if (inReview.length > 0) {
      lines.push(
        t("en", "deadline.inReview", { names: inReview.map((item) => item.member.fplManagerName).join(", ") }),
      );
    }
    lines.push(t("en", "deadline.pot", { pot: potFromObligations(obligations, gameweek.carryIn) }));

    try {
      await send(league.telegramChatId, lines.join("\n"));
    } catch (error) {
      await releaseMessage(db, league.id, key);
      throw error;
    }
  }
}

export interface LeagueStatus {
  gameweek: Gameweek;
  pot: number;
  paid: string[];
  freePass: string[];
  inReview: string[];
  unpaid: string[];
  out: string[];
}

/** Who stands where for the gameweek that's open for payment, or the last one to lock. */
export async function leagueStatus(db: PrismaClient, league: League): Promise<LeagueStatus | null> {
  const gameweek =
    (await db.gameweek.findFirst({ where: { leagueId: league.id, status: "open" }, orderBy: { fplEventId: "asc" } })) ??
    (await db.gameweek.findFirst({
      where: { leagueId: league.id, status: { in: ["locked", "settled"] } },
      orderBy: { fplEventId: "desc" },
    }));
  if (!gameweek) return null;

  const obligations = await db.obligation.findMany({
    where: { gameweekId: gameweek.id },
    include: { member: true, payments: true },
    orderBy: { memberId: "asc" },
  });
  const pending = (item: (typeof obligations)[number]) =>
    item.status !== "paid" && item.payments.some((payment) => payment.verifyStatus === "needs_review");
  const namesWhere = (test: (item: (typeof obligations)[number]) => boolean) =>
    obligations.filter(test).map((item) => item.member.fplManagerName);

  return {
    gameweek,
    pot: potFromObligations(obligations, gameweek.carryIn),
    paid: namesWhere((item) => item.status === "paid" && item.reason !== "free_pass"),
    freePass: namesWhere((item) => item.reason === "free_pass"),
    inReview: namesWhere(pending),
    unpaid: namesWhere((item) => item.status === "due" && !pending(item)),
    out: namesWhere((item) => item.status === "waived" && !pending(item)),
  };
}
