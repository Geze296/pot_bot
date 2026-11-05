import type { PrismaClient, User } from "@potbot/db";

export interface TelegramPerson {
  id: number;
  first_name: string;
  last_name?: string;
  language_code?: string;
}

export const displayName = (person: TelegramPerson): string =>
  [person.first_name, person.last_name].filter(Boolean).join(" ");

export function ensureUser(db: PrismaClient, person: TelegramPerson): Promise<User> {
  const language = person.language_code === "am" ? "am" : "en";
  return db.user.upsert({
    where: { telegramId: BigInt(person.id) },
    create: { telegramId: BigInt(person.id), displayName: displayName(person), language },
    update: { displayName: displayName(person) },
  });
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
