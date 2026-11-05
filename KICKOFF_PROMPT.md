# Claude Code prompts for Pot Bot

## Before you start (5 minutes)

1. Make an empty folder and `git init`.
2. Unzip `pot-bot-starter.zip` into it. You get:
   - `CLAUDE.md` → repo root (Claude Code reads it automatically every session)
   - `docs/SPEC.md` → the full project design
   - `docs/PRD.md` → requirements and acceptance criteria
   - `scripts/check-league.mjs` → the FPL league check
   - `KICKOFF_PROMPT.md` → this file
3. Find your league ID: open your classic league on the FPL website; the address is
   `fantasy.premierleague.com/leagues/<LEAGUE_ID>/standings/c`.
4. Run `node scripts/check-league.mjs <LEAGUE_ID> <FIRST_POT_GW>` and check the winners table against
   what you remember. It saves real data to `fixtures/fpl/` that Claude Code will use for tests.
5. Get a bot token from @BotFather (`/newbot`), then `/setprivacy` → Disable, so the bot can see
   screenshots in the group.
6. Optional: save one real Telebirr receipt page (open
   `https://transactioninfo.ethiotelecom.et/receipt/<YOUR_TXN_ID>` in a browser, Save Page As → HTML)
   to `fixtures/telebirr/receipt-1.html`. Do the same for one payment that went to someone else.

Then open Claude Code in the folder and paste **Prompt 1**.

---

## Prompt 1 — kickoff (paste this first)

```
You are building Pot Bot. Read CLAUDE.md, docs/PRD.md and docs/SPEC.md fully before doing anything.

Our real league data is in fixtures/fpl/ (from scripts/check-league.mjs). Our facts:
- FPL classic league ID: <LEAGUE_ID>
- First gameweek we played for money: GW<N>
- Entry fee: 100 birr; winner takes all; runner-up skips the next gameweek's fee
- Score: <after | before> transfer hits
- Payment closes: <at the FPL deadline | X hours after>
- Coordinator's Telebirr name: <NAME>, number: <09XXXXXXXX>
- Time zone: Africa/Addis_Ababa
- Hosting: <VPS outside Ethiopia + relay in Ethiopia | server in Ethiopia>

Goal for this session: the P0 scope in docs/PRD.md, built as milestones. Use plan mode first:
give me the folder structure, the Prisma schema, and the milestone list below with which PRD IDs
each covers. Wait for my OK before writing code.

Milestones (stop after each one, run lint + typecheck + tests, tick docs/PROGRESS.md,
and tell me exactly how to try it in Telegram):

M0  Skeleton: pnpm monorepo per CLAUDE.md, docker-compose (Postgres), .env.example, Prisma schema
    for the SPEC data model with a first migration, grammY bot answering /start, Vitest + ESLint + CI.
M1  packages/fpl + league import (L1, L2, L3): typed client for bootstrap-static, event-status,
    leagues-classic standings (with pagination and new_entries), entry history, picks, event live;
    caching and backoff. /setup <id or link> in a group shows the league and managers for
    confirmation, asks for the first pot gameweek, backfills every finished gameweek, and posts a
    "Season so far" table. Deep link onboarding where each member picks their team from buttons.
    Tests use fixtures/fpl/ and must reproduce the winners scripts/check-league.mjs printed.
M2  packages/core rules + settle (R1, R2, R3): all rule options from the SPEC, ties, free passes,
    obligations, ledger. Test-first. Settle job waits for event-status (bonus added, leagues
    Updated) + 1 hour, then posts winner, runner-up, pot and the next gameweek's free pass.
    /override for owner/coordinator, written to audit_log.
M3  packages/payments (P1, P2, P3): PaymentVerifier interface, Telebirr verifier fetching the
    receipt page (direct, or via RELAY_URL with RELAY_SECRET), parser with fixture tests, all
    checks from the SPEC Payment flow, unique txn_id, needs_review with Approve/Reject buttons
    sent privately to the coordinator. /paid <txn id>. Also a tiny relay script in tools/relay/
    I can host on cheap Ethiopian hosting.
M4  Reminders and status (M1, M2): pg-boss jobs from FPL deadlines; 48h, 24h, 18h, 6h, 3h, 1h
    and 15m, in the group and by private message, unpaid members only, idempotent. Participants
    post at the deadline. /status and /table.

Rules: follow CLAUDE.md hard rules exactly. Ask me before guessing anything about money or
results. Keep messages in locales/en.json and locales/am.json.
```

---

## Prompt 2 — after P0 works for 2 gameweeks (P1 scope)

```
Read CLAUDE.md, docs/PRD.md, docs/SPEC.md and docs/PROGRESS.md. P0 is live. Plan, then build the
P1 scope in docs/PRD.md one requirement at a time, in this order: P4 (screenshot and SMS → txn ID
with regex first, then Anthropic vision returning JSON {txn_id, amount, date}), P5, A1 (Mini App
with initData validation and roles), A2, A3, F1 (awards from picks + history + event live),
F2 + F3 (packages/ai: persona from personas/*.md, spice level 1–5, English/Amharic mix,
guardrails, daily cap, template fallback, member_facts, /me, /nofun), L4, O2, O3.
Stop after each requirement as before.
```

## Prompt 3 — open-source release (P2 scope)

```
Read CLAUDE.md, docs/PRD.md and docs/PROGRESS.md. Build P2 (F4, F5, A4, O4), then prepare the
repo for open source: README with a 60-second quickstart, how to find the FPL league ID, the
Telebirr relay setup, and a note that the bot never holds money; CONTRIBUTING.md (how to add a
persona, a locale, a payment provider); LICENSE (<MIT | AGPL-3.0>); remove anything specific to
our group from code and fixtures (keep anonymised fixtures only).
```

## Handy one-liners during the build

- "Something's off with GW<N>. Compare our computed result with fixtures and FPL, and explain the difference before changing code."
- "Write the failing test for this bug first, then fix it."
- "Review the last milestone like a strict senior engineer: money logic, idempotency, security. List issues, don't fix yet."
