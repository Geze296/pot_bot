import type { ScreenshotImage, ScreenshotReader, TextGenerator } from "@potbot/ai";
import type { PrismaClient } from "@potbot/db";
import type { FplClient } from "@potbot/fpl";

export interface BotDeps {
  db: PrismaClient;
  fpl: FplClient;
  /** Missing when there's no Gemini key. Screenshots then go to the coordinator. */
  readScreenshot?: ScreenshotReader;
  /** Missing when there's no Gemini key. Banter then uses templates. */
  generateText?: TextGenerator;
  downloadFile?: (fileId: string) => Promise<ScreenshotImage>;
  now?: () => Date;
  /** The Mini App's HTTPS address. Missing locally, because Telegram requires HTTPS. */
  webAppUrl?: string;
}
