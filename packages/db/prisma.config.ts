import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env on its own. CI sets DATABASE_URL directly, so the file is optional.
const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` needs no database, so an unset URL must not fail postinstall.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
