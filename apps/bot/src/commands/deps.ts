import type { PrismaClient } from "@potbot/db";
import type { FplClient } from "@potbot/fpl";

export interface BotDeps {
  db: PrismaClient;
  fpl: FplClient;
}
