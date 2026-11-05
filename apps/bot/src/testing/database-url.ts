const base = process.env.DATABASE_URL ?? "postgresql://potbot:potbot@localhost:5433/potbot";

export const TEST_SCHEMA = "potbot_test";
export const TEST_DATABASE_URL = `${base.split("?")[0]}?schema=${TEST_SCHEMA}`;
