import { PgBoss } from "pg-boss";

const TICK_QUEUE = "league-tick";
/** With the 1-hour grace period, this posts results within 90 minutes of FPL going final (PRD R2). */
const TICK_CRON = "*/15 * * * *";

/** Starts the Postgres-backed job queue, so schedules survive restarts. */
export async function startJobs(databaseUrl: string, tick: () => Promise<void>): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl);
  boss.on("error", (error) => console.error("pg-boss error:", error));
  await boss.start();

  await boss.createQueue(TICK_QUEUE);
  await boss.schedule(TICK_QUEUE, TICK_CRON);
  await boss.work(TICK_QUEUE, tick);
  return boss;
}
