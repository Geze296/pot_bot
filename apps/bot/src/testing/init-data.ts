import { createHmac } from "node:crypto";
import { dataCheckString, signingKey, type TelegramUser } from "../api/auth.js";

/** Signs initData exactly as Telegram does, so tests exercise the real check. */
export function signInitData(user: TelegramUser, botToken: string, signedAt: Date): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(signedAt.getTime() / 1000)),
    query_id: "test",
    user: JSON.stringify(user),
  });
  params.set("hash", createHmac("sha256", signingKey(botToken)).update(dataCheckString(params)).digest("hex"));
  return params.toString();
}
