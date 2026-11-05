import { PgBoss } from "pg-boss";

/** Starts the Postgres-backed job queue. Job handlers arrive with settling (Milestone M2) and reminders (M4). */
export async function startJobs(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl);
  boss.on("error", (error) => console.error("pg-boss error:", error));
  await boss.start();
  return boss;
}
