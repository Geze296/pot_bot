import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const valid = { BOT_TOKEN: "token", DATABASE_URL: "postgresql://localhost/db" };

describe("loadConfig", () => {
  it("reads settings and defaults the API port", () => {
    expect(loadConfig(valid)).toEqual({ botToken: "token", databaseUrl: "postgresql://localhost/db", apiPort: 3000 });
  });

  it("names every missing required setting", () => {
    expect(() => loadConfig({})).toThrow("BOT_TOKEN, DATABASE_URL");
  });

  it("treats an empty token as missing", () => {
    expect(() => loadConfig({ ...valid, BOT_TOKEN: "" })).toThrow("BOT_TOKEN");
  });

  it("rejects a bad API port", () => {
    expect(() => loadConfig({ ...valid, API_PORT: "abc" })).toThrow("API_PORT");
  });
});
