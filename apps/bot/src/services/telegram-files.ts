import type { ScreenshotImage } from "@potbot/ai";
import type { Api } from "grammy";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Fetches an image into memory only long enough to read it. It's never written to disk (hard rule 12). */
export async function downloadTelegramFile(api: Api, token: string, fileId: string): Promise<ScreenshotImage> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("Telegram gave no file path.");

  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Telegram returned ${response.status} for a file.`);

  const extension = file.file_path.split(".").pop()?.toLowerCase() ?? "";
  return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: MIME_TYPES[extension] ?? "image/jpeg" };
}
