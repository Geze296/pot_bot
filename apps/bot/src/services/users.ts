import type { Member, PrismaClient, User } from "@potbot/db";

export interface TelegramPerson {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export const displayName = (person: TelegramPerson): string =>
  [person.first_name, person.last_name].filter(Boolean).join(" ");

export function ensureUser(db: PrismaClient, person: TelegramPerson): Promise<User> {
  const language = person.language_code === "am" ? "am" : "en";
  return db.user.upsert({
    where: { telegramId: BigInt(person.id) },
    create: {
      telegramId: BigInt(person.id),
      displayName: displayName(person),
      username: person.username ?? null,
      language,
    },
    update: { displayName: displayName(person), username: person.username ?? null },
  });
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
