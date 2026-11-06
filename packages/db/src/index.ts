import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";
import { pgConnection, type DbOptions } from "./connection.js";

export * from "./connection.js";
export * from "./generated/client.js";

/** Small hosted databases allow few connections, and the job queue needs some too. */
const APP_POOL_SIZE = 5;

export function createDb(databaseUrl: string, options: DbOptions = {}): PrismaClient {
  // The adapter ignores ?schema= in the URL unless it is passed explicitly.
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg(
    { ...pgConnection(databaseUrl, options.caCert), max: APP_POOL_SIZE },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}
