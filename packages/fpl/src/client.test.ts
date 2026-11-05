import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createFplClient, FplNotFoundError, FplUnavailableError } from "./client.js";
import type { FplEntryHistory, FplStandingsPage } from "./types.js";

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/fpl/${name}`, import.meta.url), "utf8")) as T;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noSleep = async () => {};
const league = { id: 7, name: "Test", start_event: 1, scoring: "c" };

function standingsPage(overrides: Partial<FplStandingsPage>): FplStandingsPage {
  return {
    league,
    standings: { has_next: false, results: [] },
    new_entries: { has_next: false, results: [] },
    ...overrides,
  };
}

const standingRow = (entry: number) => ({
  entry,
  entry_name: `Team ${entry}`,
  player_name: `Manager ${entry}`,
  rank: entry,
  total: 0,
  event_total: 0,
});

describe("FPL requests", () => {
  it("sends a descriptive User-Agent", async () => {
    const fetch = vi.fn(async () => json({ status: [], leagues: "Updated" }));
    await createFplClient({ fetch, sleep: noSleep }).getEventStatus();

    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init[1].headers as Record<string, string>)["User-Agent"]).toContain("PotBot");
  });

  it("retries a server error with backoff, then succeeds", async () => {
    const sleep = vi.fn(noSleep);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({}, 500))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(json({ status: [], leagues: "Updated" }));

    const status = await createFplClient({ fetch, sleep }).getEventStatus();

    expect(status.leagues).toBe("Updated");
    expect(sleep.mock.calls).toEqual([[800], [1600]]);
  });

  it("gives up after four attempts with an unavailable error", async () => {
    const fetch = vi.fn(async () => json({}, 503));
    const client = createFplClient({ fetch, sleep: noSleep });

    await expect(client.getEventStatus()).rejects.toBeInstanceOf(FplUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("does not retry a 404", async () => {
    const fetch = vi.fn(async () => json({}, 404));
    const client = createFplClient({ fetch, sleep: noSleep });

    await expect(client.getLeagueStandings(999)).rejects.toBeInstanceOf(FplNotFoundError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("bootstrap cache", () => {
  const boot = { events: [], teams: [], elements: [] };

  it("reuses the response for 5 minutes, then refetches", async () => {
    let time = 0;
    const fetch = vi.fn(async () => json(boot));
    const client = createFplClient({ fetch, sleep: noSleep, now: () => time });

    await client.getBootstrap();
    time = 5 * 60 * 1000 - 1;
    await client.getBootstrap();
    expect(fetch).toHaveBeenCalledTimes(1);

    time = 5 * 60 * 1000;
    await client.getBootstrap();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last good copy when FPL is down", async () => {
    let time = 0;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(boot)).mockResolvedValue(json({}, 500));
    const client = createFplClient({ fetch, sleep: noSleep, now: () => time });

    await client.getBootstrap();
    time = 10 * 60 * 1000;

    await expect(client.getBootstrap()).resolves.toEqual(boot);
  });

  it("fails when FPL is down and nothing is cached", async () => {
    const client = createFplClient({ fetch: async () => json({}, 500), sleep: noSleep });

    await expect(client.getBootstrap()).rejects.toBeInstanceOf(FplUnavailableError);
  });
});

describe("league standings", () => {
  const route = (pages: Record<string, FplStandingsPage>) => async (url: string | URL | Request) => {
    const query = new URL(String(url)).search;
    const page = pages[query];
    return page ? json(page) : json({}, 404);
  };

  it("follows standings pages", async () => {
    const client = createFplClient({
      sleep: noSleep,
      fetch: route({
        "?page_standings=1&page_new_entries=1": standingsPage({
          standings: { has_next: true, results: [standingRow(1)] },
        }),
        "?page_standings=2&page_new_entries=1": standingsPage({
          standings: { has_next: false, results: [standingRow(2)] },
        }),
      }),
    });

    const { managers } = await client.getLeagueStandings(7);

    expect(managers.map((manager) => manager.entry)).toEqual([1, 2]);
  });

  it("includes members who only appear under new_entries, across pages", async () => {
    const newEntry = (entry: number) => ({
      entry,
      entry_name: `Team ${entry}`,
      player_first_name: "New",
      player_last_name: `Joiner${entry}`,
    });
    const client = createFplClient({
      sleep: noSleep,
      fetch: route({
        "?page_standings=1&page_new_entries=1": standingsPage({
          standings: { has_next: false, results: [standingRow(1)] },
          new_entries: { has_next: true, results: [newEntry(2)] },
        }),
        "?page_standings=1&page_new_entries=2": standingsPage({
          new_entries: { has_next: false, results: [newEntry(3)] },
        }),
      }),
    });

    const { managers } = await client.getLeagueStandings(7);

    expect(managers.map((manager) => manager.entry)).toEqual([1, 2, 3]);
    expect(managers[1]?.managerName).toBe("New Joiner2");
  });
});

// Locks the question in CLAUDE.md ("does points already include the hit?") against our real league.
describe("transfer hits, from real league data", () => {
  const histories = fixture<Record<string, FplEntryHistory>>("histories-1680179.json");
  const { managers } = fixture<{ managers: { entry: number; total: number; event_total: number }[] }>(
    "league-1680179.json",
  );

  it("history points are before hits: points minus costs equals FPL's running total", () => {
    let hitsSeen = 0;
    for (const manager of managers) {
      const current = histories[manager.entry]!.current;
      const net = current.reduce((sum, week) => sum + week.points - week.event_transfers_cost, 0);
      hitsSeen += current.filter((week) => week.event_transfers_cost > 0).length;

      expect(net).toBe(current.at(-1)!.total_points);
      expect(net).toBe(manager.total);
    }
    expect(hitsSeen).toBeGreaterThan(0);
  });

  it("standings event_total is also before hits", () => {
    const natFc = managers.find((manager) => manager.entry === 3052815)!;
    const gw9 = histories[natFc.entry]!.current.at(-1)!;

    expect(gw9.event_transfers_cost).toBe(8);
    expect(natFc.event_total).toBe(gw9.points);
  });
});
