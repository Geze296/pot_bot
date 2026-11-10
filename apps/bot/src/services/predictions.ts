import { predictionStats, rightPredictors, type PredictionStats, type PredictionWeek } from "@potbot/core";
import type { Gameweek, League, Member, PrismaClient } from "@potbot/db";
import type { Api } from "grammy";
import { t } from "../i18n/index.js";
import { claimMessage, releaseMessage } from "./message-log.js";

/** Telegram's limit on poll options. */
export const MAX_POLL_OPTIONS = 12;
/** The poll goes up with the 24-hour reminder. */
export const POLL_LEAD_MS = 24 * 60 * 60 * 1000;

/** The two Telegram calls the "who wins?" poll needs (PRD F4). */
export interface PollApi {
  sendPoll(chatId: bigint, question: string, options: string[]): Promise<{ pollId: string; messageId: number }>;
  stopPoll(chatId: bigint, messageId: number): Promise<unknown>;
}

export function telegramPolls(api: Api): PollApi {
  return {
    async sendPoll(chatId, question, options) {
      // Public, so the bot learns who voted for whom, and so does the group.
      const message = await api.sendPoll(
        Number(chatId),
        question,
        options.map((text) => ({ text })),
        { is_anonymous: false },
      );
      return { pollId: message.poll.id, messageId: message.message_id };
    },
    stopPoll: (chatId, messageId) => api.stopPoll(Number(chatId), messageId),
  };
}

/** Everyone still in the league, by team name. With more than Telegram allows, the top of the overall table. */
async function pollCandidates(db: PrismaClient, league: League): Promise<Member[]> {
  const members = await db.member.findMany({
    where: { leagueId: league.id, status: "active" },
    include: { scores: { orderBy: { gameweek: { fplEventId: "desc" } }, take: 1 } },
  });
  const total = (member: (typeof members)[number]) => member.scores[0]?.totalPoints ?? 0;
  return members
    .sort((a, b) => total(b) - total(a) || a.id - b.id)
    .slice(0, MAX_POLL_OPTIONS)
    .sort((a, b) => a.fplTeamName.localeCompare(b.fplTeamName));
}

export type PollOutcome = "posted" | "already" | "nobody";

/** Posts a gameweek's poll once, however many times it's asked (hard rule 7). */
export async function postPoll(
  db: PrismaClient,
  polls: PollApi,
  league: League,
  gameweek: Gameweek,
): Promise<PollOutcome> {
  if (gameweek.pollId) return "already";
  const key = `poll:gw${gameweek.fplEventId}`;
  if (!(await claimMessage(db, league.id, key, "poll"))) return "already";

  const candidates = await pollCandidates(db, league);
  if (candidates.length === 0) {
    await releaseMessage(db, league.id, key);
    return "nobody";
  }
  let sent: { pollId: string; messageId: number };
  try {
    const question = t("en", "poll.question", { gw: gameweek.fplEventId });
    sent = await polls.sendPoll(
      league.telegramChatId,
      question,
      candidates.map((member) => member.fplTeamName),
    );
  } catch (error) {
    await releaseMessage(db, league.id, key);
    throw error;
  }
  await db.gameweek.update({
    where: { id: gameweek.id },
    data: { pollId: sent.pollId, pollMessageId: sent.messageId, pollOptions: candidates.map((member) => member.id) },
  });
  return "posted";
}

/** The gameweek people can vote on now: its payment window is open and its deadline hasn't passed. */
export function predictableGameweek(db: PrismaClient, league: League, now: Date): Promise<Gameweek | null> {
  return db.gameweek.findFirst({
    where: { leagueId: league.id, status: "open", paymentOpensAt: { lte: now }, deadlineAt: { gt: now } },
    orderBy: { fplEventId: "asc" },
  });
}

/** Posts the poll once the deadline is a day away. */
export async function postDuePolls(db: PrismaClient, polls: PollApi, league: League, now: Date): Promise<void> {
  const gameweek = await predictableGameweek(db, league, now);
  if (!gameweek || gameweek.pollId) return;
  if (gameweek.deadlineAt.getTime() - now.getTime() > POLL_LEAD_MS) return;
  await postPoll(db, polls, league, gameweek);
}

/** Closes polls once their deadline has passed. Votes after it are ignored anyway, so a failure is only logged. */
export async function closeDuePolls(db: PrismaClient, polls: PollApi, league: League): Promise<void> {
  const due = await db.gameweek.findMany({
    where: { leagueId: league.id, status: { not: "open" }, pollMessageId: { not: null }, pollClosedAt: null },
  });
  for (const gameweek of due) {
    try {
      await polls.stopPoll(league.telegramChatId, gameweek.pollMessageId!);
    } catch (error) {
      console.error(`Couldn't close the GW${gameweek.fplEventId} poll:`, error);
    }
    await db.gameweek.update({ where: { id: gameweek.id }, data: { pollClosedAt: new Date() } });
  }
}

/**
 * Stores, changes or removes a vote. Only someone who has claimed a team counts, and only before the deadline.
 * Nothing is stored about anyone else.
 */
export async function recordVote(
  db: PrismaClient,
  answer: { pollId: string; telegramId: number; optionIds: number[] },
  now: Date,
): Promise<void> {
  const gameweek = await db.gameweek.findUnique({ where: { pollId: answer.pollId } });
  if (!gameweek || now >= gameweek.deadlineAt) return;
  const voter = await db.member.findFirst({
    where: { leagueId: gameweek.leagueId, status: "active", user: { telegramId: BigInt(answer.telegramId) } },
  });
  if (!voter) return;

  const picked = gameweek.pollOptions[answer.optionIds[0] ?? -1];
  if (picked === undefined) {
    await db.prediction.deleteMany({ where: { gameweekId: gameweek.id, memberId: voter.id } });
    return;
  }
  await db.prediction.upsert({
    where: { gameweekId_memberId: { gameweekId: gameweek.id, memberId: voter.id } },
    create: { gameweekId: gameweek.id, memberId: voter.id, pickedMemberId: picked, votedAt: now },
    update: { pickedMemberId: picked, votedAt: now },
  });
}

const VOTE_ORDER = { orderBy: [{ votedAt: "asc" as const }, { id: "asc" as const }] };

const weekOf = (winnerIds: number[], predictions: { memberId: number; pickedMemberId: number }[]): PredictionWeek => ({
  winnerIds,
  votes: predictions.map((vote) => ({ voterId: vote.memberId, pickedId: vote.pickedMemberId })),
});

/** "Called it" for the results post, or nothing when there was no poll, no votes or no winner. */
export async function predictionLine(db: PrismaClient, gameweek: Gameweek): Promise<string | null> {
  if (!gameweek.pollId) return null;
  const result = await db.result.findUnique({ where: { gameweekId: gameweek.id } });
  if (!result || result.winnerMemberIds.length === 0) return null;
  const predictions = await db.prediction.findMany({
    where: { gameweekId: gameweek.id },
    include: { member: true },
    ...VOTE_ORDER,
  });
  if (predictions.length === 0) return null;

  const right = new Set(rightPredictors(weekOf(result.winnerMemberIds, predictions)));
  const names = predictions.filter((vote) => right.has(vote.memberId)).map((vote) => vote.member.fplManagerName);
  return names.length > 0 ? t("en", "poll.calledIt", { names: names.join(", ") }) : t("en", "poll.nobodyCalledIt");
}

/**
 * Season accuracy, worked out from the votes and the current results each time, so a corrected result counts
 * straight away.
 */
export async function leaguePredictions(db: PrismaClient, leagueId: number): Promise<PredictionStats[]> {
  const gameweeks = await db.gameweek.findMany({
    where: { leagueId, pollId: { not: null }, result: { isNot: null } },
    include: { result: true, predictions: VOTE_ORDER },
    orderBy: { fplEventId: "asc" },
  });
  return predictionStats(gameweeks.map((gameweek) => weekOf(gameweek.result!.winnerMemberIds, gameweek.predictions)));
}
