#!/usr/bin/env node
// Pot Bot — FPL league check
// Loads your FPL classic league, every manager, and every finished gameweek,
// then prints who won / came second / came last each week, so you can confirm
// the data is right before building. Also saves everything to fixtures/ for tests.
//
// Usage:
//   node scripts/check-league.mjs <leagueId | league URL> [firstPotGw]
// Examples:
//   node scripts/check-league.mjs 123456
//   node scripts/check-league.mjs https://fantasy.premierleague.com/leagues/123456/standings/c 3
//
// Needs Node.js 18+ (built-in fetch). No dependencies.

import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://fantasy.premierleague.com/api/";
const UA = "PotBot-league-check/0.1 (+https://github.com/your-org/pot-bot)";
const ENTRY_FEE = 100; // birr, only used for the pot illustration

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(BASE + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 404) throw Object.assign(new Error(`Not found: ${path}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.json();
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err;
      await sleep(800 * attempt);
    }
  }
  throw lastErr;
}

function parseLeagueId(arg) {
  if (!arg) return null;
  const fromUrl = String(arg).match(/leagues\/(\d+)/);
  if (fromUrl) return Number(fromUrl[1]);
  if (/^\d+$/.test(String(arg))) return Number(arg);
  return null;
}

async function loadStandings(leagueId) {
  let page = 1;
  let league;
  const managers = [];
  for (;;) {
    const data = await get(`leagues-classic/${leagueId}/standings/?page_standings=${page}`);
    league = data.league;
    managers.push(...(data.standings?.results ?? []));
    // Before the league's first scored gameweek, members are listed under new_entries.
    if (page === 1 && managers.length === 0 && data.new_entries?.results?.length) {
      managers.push(
        ...data.new_entries.results.map((e) => ({
          entry: e.entry,
          entry_name: e.entry_name,
          player_name: `${e.player_first_name ?? ""} ${e.player_last_name ?? ""}`.trim(),
          rank: null,
          total: 0,
          event_total: 0,
        })),
      );
    }
    if (!data.standings?.has_next) break;
    page += 1;
    await sleep(300);
  }
  return { league, managers };
}

function settle(rows) {
  // rows: [{ name, net }] — highest net wins; ties share. Runner-up = next distinct score.
  const sorted = [...rows].sort((a, b) => b.net - a.net);
  const top = sorted[0]?.net;
  const winners = sorted.filter((r) => r.net === top);
  const rest = sorted.filter((r) => r.net !== top);
  const second = rest[0]?.net;
  const runnersUp = rest.filter((r) => r.net === second);
  const bottom = sorted.at(-1)?.net;
  const spoon = sorted.filter((r) => r.net === bottom);
  return { sorted, winners, runnersUp, spoon };
}

async function main() {
  const leagueId = parseLeagueId(process.argv[2]);
  const firstPotGw = Number(process.argv[3] ?? 1);
  if (!leagueId) {
    console.error("Give your league ID or link, e.g.  node scripts/check-league.mjs 123456");
    process.exit(1);
  }

  console.log(`Loading FPL data for league ${leagueId}…`);
  const boot = await get("bootstrap-static/");
  const events = boot.events.map((e) => ({
    id: e.id,
    name: e.name,
    deadline_time: e.deadline_time,
    finished: e.finished,
    data_checked: e.data_checked,
    is_current: e.is_current,
    is_next: e.is_next,
  }));
  const status = await get("event-status/").catch(() => null);
  const { league, managers } = await loadStandings(leagueId);

  console.log(`\nLeague: ${league?.name ?? "(unknown)"}  ·  ${managers.length} managers`);
  console.table(
    managers.map((m) => ({
      rank: m.rank,
      manager: m.player_name,
      team: m.entry_name,
      entry_id: m.entry,
      total: m.total,
      this_gw: m.event_total,
    })),
  );

  const histories = {};
  for (const m of managers) {
    histories[m.entry] = await get(`entry/${m.entry}/history/`);
    await sleep(300);
  }

  const finished = events.filter((e) => e.finished && e.id >= firstPotGw);
  const weekly = [];
  for (const ev of finished) {
    const rows = managers
      .map((m) => {
        const h = histories[m.entry]?.current?.find((c) => c.event === ev.id);
        if (!h) return null; // manager had not started yet
        return {
          name: m.player_name,
          team: m.entry_name,
          gross: h.points,
          hits: h.event_transfers_cost,
          net: h.points - h.event_transfers_cost,
          bench: h.points_on_bench,
        };
      })
      .filter(Boolean);
    if (rows.length === 0) continue;
    const { sorted, winners, runnersUp, spoon } = settle(rows);
    weekly.push({ gw: ev.id, rows: sorted, winners, runnersUp, spoon });
  }

  console.log(`\nFinished gameweeks from GW${firstPotGw} (score = points − transfer cost):`);
  console.table(
    weekly.map((w) => ({
      GW: w.gw,
      winner: w.winners.map((r) => `${r.name} (${r.net})`).join(" & "),
      runner_up_free_pass: w.runnersUp.map((r) => `${r.name} (${r.net})`).join(" & "),
      wooden_spoon: w.spoon.map((r) => `${r.name} (${r.net})`).join(" & "),
      most_bench: (() => {
        const b = [...w.rows].sort((a, c) => c.bench - a.bench)[0];
        return b ? `${b.name} (${b.bench})` : "";
      })(),
    })),
  );

  // Season tally under the default rules: winner takes all, runner-up skips next fee.
  const tally = Object.fromEntries(managers.map((m) => [m.player_name, { wins: 0, paid: 0, won: 0 }]));
  let freePass = new Set();
  for (const w of weekly) {
    const payers = w.rows.filter((r) => !freePass.has(r.name));
    const pot = payers.length * ENTRY_FEE;
    payers.forEach((r) => (tally[r.name].paid += ENTRY_FEE));
    const share = Math.floor(pot / w.winners.length);
    w.winners.forEach((r) => {
      tally[r.name].wins += 1;
      tally[r.name].won += share;
    });
    freePass = new Set(w.runnersUp.map((r) => r.name));
  }
  console.log(`\nSeason so far if everyone paid ${ENTRY_FEE} birr (free passes applied), birr:`);
  console.table(
    Object.entries(tally)
      .map(([name, t]) => ({ manager: name, wins: t.wins, paid_in: t.paid, won: t.won, net: t.won - t.paid }))
      .sort((a, b) => b.net - a.net),
  );

  if (status?.status?.length) {
    console.log("\nFPL event-status (settle only when bonus_added is true and leagues is 'Updated'):");
    console.log(JSON.stringify(status, null, 2));
  }

  await mkdir("fixtures/fpl", { recursive: true });
  await writeFile(`fixtures/fpl/league-${leagueId}.json`, JSON.stringify({ league, managers }, null, 2));
  await writeFile(`fixtures/fpl/histories-${leagueId}.json`, JSON.stringify(histories, null, 2));
  await writeFile("fixtures/fpl/events.json", JSON.stringify(events, null, 2));
  if (status) await writeFile("fixtures/fpl/event-status.json", JSON.stringify(status, null, 2));
  console.log(`\nSaved raw data to fixtures/fpl/ for tests.`);
  console.log(
    "CHECK: open one past gameweek on the FPL site. If a manager who took a -4 hit shows the same score as 'net' above, the maths is right; if it matches 'gross', points already include the hit — tell Claude Code.",
  );
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  console.error("If you are outside the FPL site's reach (VPN, firewall), try again from another network.");
  process.exit(1);
});
