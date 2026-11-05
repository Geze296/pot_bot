import { PgBoss } from "pg-boss";

const TICK_QUEUE = "league-tick";
/** With the 1-hour grace period, this posts results within 90 minutes of FPL going final (PRD R2). */
const TICK_CRON = "*/15 * * * *";
const SYNC_QUEUE = "league-sync";
/** A new FPL joiner shows up within an hour (PRD L4). */
const SYNC_CRON = "0 * * * *";

const DELETE_QUEUE = "delete-message";
const DELETE_AFTER_SECONDS = 10 * 60;

interface DeleteJob {
  chatId: number;
  messageId: number;
}

export interface JobHandlers {
  tick: () => Promise<void>;
  sync: () => Promise<void>;
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
}

/** Stored in Postgres, so a restart during the 10 minutes doesn't leave the message behind. */
export function scheduleMessageDeletion(boss: PgBoss, chatId: number, messageId: number) {
  return boss.send(DELETE_QUEUE, { chatId, messageId } satisfies DeleteJob, { startAfter: DELETE_AFTER_SECONDS });
}

/** Starts the Postgres-backed job queue, so schedules survive restarts. */
export async function startJobs(databaseUrl: string, handlers: JobHandlers): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl);
  boss.on("error", (error) => console.error("pg-boss error:", error));
  await boss.start();

  await boss.createQueue(TICK_QUEUE);
  await boss.schedule(TICK_QUEUE, TICK_CRON);
  await boss.work(TICK_QUEUE, handlers.tick);

  await boss.createQueue(SYNC_QUEUE);
  await boss.schedule(SYNC_QUEUE, SYNC_CRON);
  await boss.work(SYNC_QUEUE, handlers.sync);

  await boss.createQueue(DELETE_QUEUE);
  await boss.work<DeleteJob>(DELETE_QUEUE, async (jobs) => {
    for (const { data } of jobs) {
      try {
        await handlers.deleteMessage(data.chatId, data.messageId);
      } catch (error) {
        // Someone may have deleted it already, so there's nothing worth retrying.
        console.error("Couldn't delete a message:", error);
      }
    }
  });
  return boss;
}
