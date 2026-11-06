import { describe, expect, it } from "vitest";
import { pgConnection } from "./connection.js";

const URL_WITH_SSL = "postgres://user:pass@db.example.com:12345/app?sslmode=require";

describe("pgConnection", () => {
  it("leaves the URL alone with no certificate", () => {
    expect(pgConnection(URL_WITH_SSL)).toEqual({ connectionString: URL_WITH_SSL });
  });

  it("with a certificate, drops sslmode so it can't override the check, and verifies", () => {
    expect(pgConnection(URL_WITH_SSL, "CERT")).toEqual({
      connectionString: "postgres://user:pass@db.example.com:12345/app",
      ssl: { ca: "CERT", rejectUnauthorized: true },
    });
  });

  it("keeps other settings, such as the schema", () => {
    const { connectionString } = pgConnection(`${URL_WITH_SSL}&schema=test`, "CERT");

    expect(connectionString).toBe("postgres://user:pass@db.example.com:12345/app?schema=test");
  });

  it("restores line breaks stored as text by a host's settings page", () => {
    expect(pgConnection(URL_WITH_SSL, "LINE1\\nLINE2").ssl?.ca).toBe("LINE1\nLINE2");
  });
});
