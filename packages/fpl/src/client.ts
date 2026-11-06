import type {
  FplBootstrap,
  FplEntryHistory,
  FplEventLive,
  FplEventStatus,
  FplPicks,
  FplStandingsPage,
  LeagueManager,
  LeagueStandings,
} from "./types.js";

const BASE_URL = "https://fantasy.premierleague.com/api/";
const USER_AGENT = "PotBot/0.1 (FPL mini-league bot)";
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = 800;
const REQUEST_TIMEOUT_MS = 5_000;
const BETWEEN_CALLS_MS = 300;
const BOOTSTRAP_CACHE_MS = 5 * 60 * 1000;
/** Pot Bot is for friends' leagues. A mistyped ID could otherwise page through millions of FPL's public managers. */
const MAX_LEAGUE_MANAGERS = 200;

export class FplNotFoundError extends Error {}
export class FplUnavailableError extends Error {}
export class FplLeagueTooBigError extends Error {}

export interface FplClientOptions {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type FplClient = ReturnType<typeof createFplClient>;

export function createFplClient(options: FplClientOptions = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  async function get<T>(path: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetchFn(BASE_URL + path, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.status === 404) throw new FplNotFoundError(`FPL has nothing at ${path}`);
        if (!response.ok) throw new FplUnavailableError(`FPL returned ${response.status} for ${path}`);
        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof FplNotFoundError) throw error;
        lastError = error;
        if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS * attempt);
      }
    }
    throw new FplUnavailableError(`FPL is unavailable for ${path}: ${String(lastError)}`);
  }

  let bootstrapCache: { value: FplBootstrap; fetchedAt: number } | undefined;

  /** Cached for 5 minutes. If FPL is down, the last good copy is used rather than failing. */
  async function getBootstrap(): Promise<FplBootstrap> {
    if (bootstrapCache && now() - bootstrapCache.fetchedAt < BOOTSTRAP_CACHE_MS) return bootstrapCache.value;
    try {
      const value = await get<FplBootstrap>("bootstrap-static/");
      bootstrapCache = { value, fetchedAt: now() };
      return value;
    } catch (error) {
      if (bootstrapCache) return bootstrapCache.value;
      throw error;
    }
  }

  /** Walks both lists: members who joined after the last scored gameweek appear only under new_entries. */
  async function getLeagueStandings(leagueId: number): Promise<LeagueStandings> {
    const managers = new Map<number, LeagueManager>();
    const standingsPath = (standingsPage: number, newEntriesPage: number) =>
      `leagues-classic/${leagueId}/standings/?page_standings=${standingsPage}&page_new_entries=${newEntriesPage}`;

    const firstPage = await get<FplStandingsPage>(standingsPath(1, 1));
    let page = firstPage;
    for (let number = 1; ; number++) {
      for (const row of page.standings.results) {
        managers.set(row.entry, { entry: row.entry, teamName: row.entry_name, managerName: row.player_name });
      }
      if (managers.size > MAX_LEAGUE_MANAGERS) throw new FplLeagueTooBigError(`League ${leagueId} is too big.`);
      if (!page.standings.has_next) break;
      await sleep(BETWEEN_CALLS_MS);
      page = await get<FplStandingsPage>(standingsPath(number + 1, 1));
    }

    page = firstPage;
    for (let number = 1; ; number++) {
      for (const row of page.new_entries.results) {
        if (managers.has(row.entry)) continue;
        managers.set(row.entry, {
          entry: row.entry,
          teamName: row.entry_name,
          managerName: `${row.player_first_name} ${row.player_last_name}`.trim(),
        });
      }
      if (!page.new_entries.has_next) break;
      await sleep(BETWEEN_CALLS_MS);
      page = await get<FplStandingsPage>(standingsPath(1, number + 1));
    }

    return { league: firstPage.league, managers: [...managers.values()] };
  }

  /** One manager at a time with a short pause, to poll FPL gently. */
  async function getEntryHistories(entries: number[]): Promise<Map<number, FplEntryHistory>> {
    const histories = new Map<number, FplEntryHistory>();
    for (const [index, entry] of entries.entries()) {
      if (index > 0) await sleep(BETWEEN_CALLS_MS);
      histories.set(entry, await get<FplEntryHistory>(`entry/${entry}/history/`));
    }
    return histories;
  }

  /** Skips a manager with no team that gameweek, which FPL reports as not found. */
  async function getPicksForEntries(entries: number[], event: number): Promise<Map<number, FplPicks>> {
    const picks = new Map<number, FplPicks>();
    for (const [index, entry] of entries.entries()) {
      if (index > 0) await sleep(BETWEEN_CALLS_MS);
      try {
        picks.set(entry, await get<FplPicks>(`entry/${entry}/event/${event}/picks/`));
      } catch (error) {
        if (!(error instanceof FplNotFoundError)) throw error;
      }
    }
    return picks;
  }

  return {
    getBootstrap,
    getLeagueStandings,
    getEntryHistories,
    getPicksForEntries,
    getEventStatus: () => get<FplEventStatus>("event-status/"),
    getEntryHistory: (entry: number) => get<FplEntryHistory>(`entry/${entry}/history/`),
    getPicks: (entry: number, event: number) => get<FplPicks>(`entry/${entry}/event/${event}/picks/`),
    getEventLive: (event: number) => get<FplEventLive>(`event/${event}/live/`),
  };
}
