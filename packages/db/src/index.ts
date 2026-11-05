import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.js";

export * from "./generated/client.js";

export function createDb(databaseUrl: string): PrismaClient {
  // The adapter ignores ?schema= in the URL unless it is passed explicitly.
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg({ connectionString: databaseUrl }, schema ? { schema } : undefined);
  return new PrismaClient({ adapter });
}
