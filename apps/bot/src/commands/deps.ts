import type { ScreenshotImage, ScreenshotReader } from "@potbot/ai";
import type { PrismaClient } from "@potbot/db";
import type { FplClient } from "@potbot/fpl";

export interface BotDeps {
  db: PrismaClient;
  fpl: FplClient;
  /** Missing when there's no Gemini key. Screenshots then go to the coordinator. */
  readScreenshot?: ScreenshotReader;
  downloadFile?: (fileId: string) => Promise<ScreenshotImage>;
  now?: () => Date;
}
