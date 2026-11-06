import { ScreenshotReadError, type ScreenshotReading } from "@potbot/ai";
import type { League } from "@potbot/db";
import type { Api, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import { claimMessage } from "../services/message-log.js";
import type { BotDeps } from "./deps.js";

/** Keeps a burst of photos, or a bug, from running up the league's AI bill (hard rule 15). */
const DAILY_READ_CAP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Image {
  fileId: string;
  uniqueId: string;
  isPhoto: boolean;
}

export function imageIn(message: Message | undefined): Image | null {
  const photo = message?.photo?.at(-1);
  if (photo) return { fileId: photo.file_id, uniqueId: photo.file_unique_id, isPhoto: true };
  const document = message?.document;
  if (document?.mime_type?.startsWith("image/")) {
    return { fileId: document.file_id, uniqueId: document.file_unique_id, isPhoto: false };
  }
  return null;
}

export function sendImage(
  api: Api,
  chatId: number,
  image: Pick<Image, "fileId" | "isPhoto">,
  options: { caption: string; reply_markup?: InlineKeyboard },
) {
  return image.isPhoto ? api.sendPhoto(chatId, image.fileId, options) : api.sendDocument(chatId, image.fileId, options);
}

/** Reads an image. Null means "couldn't tell", for any reason, and never says anything about the payment itself. */
export async function readImage(
  deps: BotDeps,
  league: League,
  image: Image,
  now: Date,
): Promise<ScreenshotReading | null> {
  if (!deps.readScreenshot || !deps.downloadFile) return null;

  const reads = await deps.db.messageLog.count({
    where: { leagueId: league.id, kind: "screenshot_read", sentAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  if (reads >= DAILY_READ_CAP) return null;

  try {
    const reading = await deps.readScreenshot(await deps.downloadFile(image.fileId));
    await claimMessage(deps.db, league.id, `read:${image.uniqueId}`, "screenshot_read");
    return reading;
  } catch (error) {
    if (!(error instanceof ScreenshotReadError)) console.error("Screenshot download failed:", error);
    return null;
  }
}
