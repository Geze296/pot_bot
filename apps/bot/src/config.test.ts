import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const valid = { BOT_TOKEN: "token", DATABASE_URL: "postgresql://localhost/db" };

describe("loadConfig", () => {
  it("reads settings and defaults the API port", () => {
    expect(loadConfig(valid)).toEqual({
      botToken: "token",
      databaseUrl: "postgresql://localhost/db",
      apiPort: 3000,
      apiHost: "127.0.0.1",
    });
  });

  it("names every missing required setting", () => {
    expect(() => loadConfig({})).toThrow("BOT_TOKEN, DATABASE_URL");
  });

  it("treats an empty token as missing", () => {
    expect(() => loadConfig({ ...valid, BOT_TOKEN: "" })).toThrow("BOT_TOKEN");
  });

  it("reads the public address and host, dropping a trailing slash", () => {
    const config = loadConfig({ ...valid, PUBLIC_URL: "https://bot.example.com/", API_HOST: "0.0.0.0" });

    expect(config.publicUrl).toBe("https://bot.example.com");
    expect(config.apiHost).toBe("0.0.0.0");
  });

  it("refuses a public address that isn't HTTPS", () => {
    expect(() => loadConfig({ ...valid, PUBLIC_URL: "http://bot.example.com" })).toThrow("https://");
  });

  it("rejects a bad API port", () => {
    expect(() => loadConfig({ ...valid, API_PORT: "abc" })).toThrow("API_PORT");
  });
});
