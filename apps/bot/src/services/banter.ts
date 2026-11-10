import { readFileSync } from "node:fs";
import { buildSystemPrompt, cleanOutput, type LanguageMix, type TextGenerator } from "@potbot/ai";
import type { Gameweek, League, Member, PrismaClient } from "@potbot/db";
import { t } from "../i18n/index.js";
import type { StoredAwards } from "./awards.js";
import { claimMessage, releaseMessage } from "./message-log.js";
import type { SendOptions } from "./settlement.js";

/** Bot messages written by AI per league per day. After this, templates take over (hard rule 15). */
export const DAILY_AI_CAP = 30;
/** Of those, how many can be chat replies, so a talkative group can't use up the recap's allowance. */
const DAILY_MENTION_CAP = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PERSONAS = ["commentator", "pundit", "grandfather"] as const;
export type PersonaName = (typeof PERSONAS)[number];

export interface PersonaSettings {
  name: PersonaName;
  spice: number;
  language: LanguageMix;
}

export const DEFAULT_PERSONA: PersonaSettings = { name: "commentator", spice: 3, language: "en" };

export function personaSettings(league: Pick<League, "persona">): PersonaSettings {
  return { ...DEFAULT_PERSONA, ...(league.persona as Partial<PersonaSettings>) };
}

function personaText(name: PersonaName): string {
  return readFileSync(new URL(`../../../../personas/${name}.md`, import.meta.url), "utf8");
}

export interface BanterDeps {
  db: PrismaClient;
  generateText?: TextGenerator;
  now?: () => Date;
}

/**
 * One AI-written message, or null if there's no key, the cap is reached, the call fails, or the text breaks a rule.
 * Callers always have a template or simply say nothing, so AI failing is never visible as an error.
 */
export async function aiLine(
  deps: BanterDeps,
  league: League,
  prompt: string,
  now: Date,
  kind: "ai_text" | "ai_mention" = "ai_text",
): Promise<string | null> {
  const { db, generateText } = deps;
  if (!generateText) return null;

  const since = { gte: new Date(now.getTime() - DAY_MS) };
  const used = await db.messageLog.count({
    where: { leagueId: league.id, kind: { in: ["ai_text", "ai_mention"] }, sentAt: since },
  });
  if (used >= DAILY_AI_CAP) return null;
  if (kind === "ai_mention") {
    const mentions = await db.messageLog.count({ where: { leagueId: league.id, kind, sentAt: since } });
    if (mentions >= DAILY_MENTION_CAP) return null;
  }

  const optedOut = await db.member.findMany({ where: { leagueId: league.id, roastOptOut: true } });
  const doNotMention = optedOut.flatMap((member) => [member.fplManagerName, member.fplTeamName]);
  const settings = personaSettings(league);
  const system = buildSystemPrompt({
    persona: personaText(settings.name),
    spice: settings.spice,
    language: settings.language,
    doNotMention,
  });

  try {
    const text = cleanOutput(await generateText(system, prompt), doNotMention);
    if (!text) return null;
    await db.messageLog.create({
      data: {
        leagueId: league.id,
        dedupeKey: `ai:${now.getTime()}:${used}:${Math.random()}`,
        kind,
        sentAt: now,
      },
    });
    return text;
  } catch (error) {
    console.error("AI text failed, so a template is used:", error);
    return null;
  }
}

/** The facts the AI is allowed to use about a member, leaving out anyone who opted out. */
function factsFor(members: (Member & { facts: { fact: string }[] })[]): string[] {
  return members
    .filter((member) => !member.roastOptOut && member.facts.length > 0)
    .map((member) => `${member.fplManagerName}: ${member.facts.map((item) => item.fact).join("; ")}`);
}

function recapPrompt(
  gameweek: Gameweek,
  rows: { name: string; net: number; hits: number; bench: number }[],
  result: { winners: string[]; runnersUp: string[]; awards: StoredAwards | null },
  facts: string[],
): string {
  const table = rows.map((row) => `${row.name}: ${row.net} (hits ${row.hits}, bench ${row.bench})`).join("\n");
  return [
    `Write a short recap of gameweek ${gameweek.fplEventId} for the group chat.`,
    `Winner: ${result.winners.join(" & ") || "nobody"}. Runner-up: ${result.runnersUp.join(" & ") || "nobody"}.`,
    `Scores after hits:\n${table}`,
    facts.length > 0 ? `Things the group knows about people:\n${facts.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Posts a short recap after each gameweek's awards, once. With no AI it uses a plain line. */
export async function postPendingRecaps(
  deps: BanterDeps & { send: (chatId: bigint, text: string, options?: SendOptions) => Promise<unknown> },
  league: League,
  now: Date,
): Promise<void> {
  const { db, send } = deps;
  const settled = await db.gameweek.findMany({
    where: {
      leagueId: league.id,
      status: "settled",
      finalSeenAt: { not: null },
      result: { awards: { not: { equals: null } } },
    },
    include: { result: true, scores: true },
    orderBy: { fplEventId: "asc" },
  });
  if (settled.length === 0) return;

  const members = await db.member.findMany({ where: { leagueId: league.id }, include: { facts: true } });
  const nameOf = (id: number) => members.find((member) => member.id === id)?.fplManagerName ?? String(id);

  for (const gameweek of settled) {
    const { result } = gameweek;
    const key = `recap:gw${gameweek.fplEventId}`;
    if (!result || !(await claimMessage(db, league.id, key, "recap"))) continue;

    const winners = result.winnerMemberIds.map(nameOf);
    const rows = gameweek.scores
      .map((score) => ({
        name: nameOf(score.memberId),
        net: score.points - score.transferCost,
        hits: score.transferCost,
        bench: score.benchPoints,
      }))
      .sort((a, b) => b.net - a.net);
    const prompt = recapPrompt(
      gameweek,
      rows,
      {
        winners,
        runnersUp: result.runnerUpMemberIds.map(nameOf),
        awards: result.awards as unknown as StoredAwards | null,
      },
      factsFor(members),
    );

    const text =
      (await aiLine(deps, league, prompt, now)) ??
      t("en", winners.length > 0 ? "recap.template" : "recap.templateNoWinner", {
        gw: gameweek.fplEventId,
        winners: winners.join(" & "),
      });
    try {
      await send(league.telegramChatId, text);
    } catch (error) {
      await releaseMessage(db, league.id, key);
      throw error;
    }
  }
}

export function roastPrompt(
  member: Member & { facts: { fact: string }[] },
  latest: { event: number; net: number; hits: number; bench: number; captainPoints: number | null } | null,
  /** Set when the roast turns on the person who asked for it: the name of who they wanted roasted. */
  backfireFrom?: string,
): string {
  return [
    `Write a short roast of ${member.fplManagerName}, whose FPL team is ${member.fplTeamName}.`,
    backfireFrom
      ? `Plot twist: they asked you to roast ${backfireFrom}, but you turn on them instead. Be dramatic about the betrayal, then roast their own FPL.`
      : "",
    latest
      ? `In gameweek ${latest.event} they scored ${latest.net} after hits, spent ${latest.hits} on hits, left ${latest.bench} on the bench, and their captain got ${latest.captainPoints ?? "an unknown number of"} points.`
      : "They have no scores in the bot yet, so joke about the wait.",
    "Talk to them as you. Their Telegram @username is put in front of your message, so don't start with their name.",
    member.facts.length > 0 ? `Things the group knows: ${member.facts.map((item) => item.fact).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function mentionPrompt(senderName: string, text: string, table: string): string {
  return [
    `${senderName} said this to you in the group chat: """${text}"""`,
    `Reply in character.${table ? `\n\nThe league's latest scores:\n${table}` : ""}`,
  ].join("\n");
}
