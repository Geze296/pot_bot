import { execFileSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./apps/bot/src/testing/database-url.js";

/** Migrates a separate schema, so tests never touch development data. Needs: docker compose up -d db */
export default function setup(): void {
  try {
    execFileSync("pnpm", ["--filter", "@potbot/db", "migrate:deploy"], {
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    });
  } catch (error) {
    const detail =
      error instanceof Error && "stdout" in error ? `${String(error.stdout)}${String(error.stderr)}` : String(error);
    throw new Error(`Couldn't prepare the test database. Is it running? Try: docker compose up -d db\n${detail}`);
  }
}
