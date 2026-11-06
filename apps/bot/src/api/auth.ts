import { createHmac, timingSafeEqual } from "node:crypto";

/** A stolen or logged request stops working after this long. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export function signingKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

/** Telegram's rule: every field except the hash, sorted by name, as key=value lines. */
export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
}

/**
 * Checks Telegram's signature on a Mini App's initData and returns who it says the user is, or null. This is the
 * only source of identity for the API, so nothing else a browser sends is trusted about who someone is.
 */
export function verifyInitData(initData: string, botToken: string, now: Date): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  const expected = createHmac("sha256", signingKey(botToken)).update(dataCheckString(params)).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const signedAt = Number(params.get("auth_date"));
  if (!Number.isFinite(signedAt) || now.getTime() / 1000 - signedAt > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "") as TelegramUser;
    return Number.isInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}
