import { describe, expect, it } from "vitest";
import { createApi } from "./server.js";

describe("GET /health", () => {
  it("returns ok when the database answers", async () => {
    const api = createApi({ checkDb: async () => {} });
    const response = await api.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns 503 when the database does not answer", async () => {
    const api = createApi({
      checkDb: async () => {
        throw new Error("connection refused");
      },
    });
    const response = await api.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "db_unavailable" });
  });
});
