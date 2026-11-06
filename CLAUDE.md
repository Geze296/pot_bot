# Pot Bot — project memory for Claude Code

Pot Bot is a Telegram bot + Telegram Mini App that runs a weekly paid FPL (Fantasy Premier League)
classic mini-league for a friend group: it imports the league from FPL, verifies Telebirr payments,
reminds late payers, settles each gameweek automatically, and keeps the group chat fun with an AI persona.

**Before any task, read `docs/PRD.md` (what to build, requirement IDs, acceptance criteria) and
`docs/SPEC.md` (product design, rules, data model, flows).** If code and docs disagree, ask me.

## Stack (do not swap without asking)

- TypeScript (strict) on Node.js 20+, pnpm workspaces
- `apps/bot` — grammY Telegram bot (long polling in dev, webhook in prod)
- `apps/web` — React + Vite Telegram Mini App; its backend API lives in `apps/bot` (Fastify) to keep one server
- `packages/core` — PURE domain logic: rules, pot maths, ties, free passes, obligations, ledger, awards. No I/O.
- `packages/fpl` — typed FPL API client with caching + retry
- `packages/payments` — `PaymentVerifier` interface + Telebirr implementation (+ optional Ethiopia relay)
- `packages/ai` — Gemini API wrapper, personas, guardrails, template fallback
- `packages/db` — Prisma schema + client for PostgreSQL
- Jobs: pg-boss (Postgres-backed, no Redis)
- Tests: Vitest. Lint: ESLint + Prettier. CI: GitHub Actions running lint + typecheck + tests.

## Commands

```
pnpm install
docker compose up -d db        # Postgres only
pnpm db:migrate                # prisma migrate dev
pnpm dev                       # bot + api + web
pnpm test                      # vitest, all packages (needs the db running; uses its own schema)
pnpm lint && pnpm typecheck
node scripts/check-league.mjs <leagueId|leagueUrl> [firstPotGw]   # sanity-check real FPL data
docker compose up -d --build   # run everything on a server, using a filled .env
```

## Domain words

- FPL names: **event** = gameweek, **entry** = manager/team, **element** = footballer, **classic league** = mini-league.
- **Pot** = sum of paid entry fees for a gameweek. **Free pass** = the winner and runner-up skip next gameweek's fee. **Collector** = the coordinator, if they also play: their fee is counted automatically, and they're never reminded or sent a payout.
- **Obligation** = what a member owes for a gameweek (entry fee, free pass = 0, late fee).
- **Net score** = gameweek `points` − `event_transfers_cost` (confirm on real data whether `points` already includes the hit; a test locks the answer).
- **Settle** = compute winner(s), runner(s)-up, awards, next week's obligations, and post results.

## Hard rules

1. **Money is integer birr** (no floats). All times stored in UTC; display in the league's time zone (default `Africa/Addis_Ababa`).
2. **`packages/core` is pure and test-first.** Write failing tests before code for rules, ties, settle, obligations and ledger.
3. **Never call live FPL or Telebirr in tests.** Use saved JSON/HTML in `fixtures/`. If a fixture is missing, ask me to run the check script or paste a receipt page.
4. **Never settle a gameweek** until FPL `event-status/` shows bonus added and leagues updated, plus a 1-hour grace period.
5. **Never auto-reject a payment because a receipt could not be fetched.** Unreachable or ambiguous → `needs_review` → coordinator gets Approve/Reject buttons.
6. **`txn_id` is unique across the whole database.** A reused transaction ID is always rejected.
7. **Jobs are idempotent.** Running any scheduled job twice must not post twice, charge twice or settle twice.
8. **Every manual override writes to `audit_log`** and wins over FPL data (`source: manual`).
9. **Every user-facing string comes from `locales/en.json` / `locales/am.json`** (AI-generated text excepted).
10. **The bot never holds or sends money.** Don't add features that imply it does.
11. **Secrets only in `.env`** (never committed). Keep `.env.example` up to date.
12. **Store minimal personal data**: transaction ID, amount, date, status, match flags. Delete screenshots after extracting the ID.
13. FPL API is unofficial: server-side only (no CORS), descriptive `User-Agent`, cache `bootstrap-static` ≥ 5 min, back off on errors, keep all FPL calls inside `packages/fpl`.
14. Telebirr receipt URL: `https://transactioninfo.ethiotelecom.et/receipt/<TXN_ID>`. It may block non-Ethiopian IPs: support `RELAY_URL` + `RELAY_SECRET`. Keep the HTML parser in one file with a fixture test — the page layout can change.
15. AI is optional: with no `GEMINI_API_KEY`, every AI feature falls back to templates (a payment screenshot goes to the coordinator). Enforce a per-league daily cap. Roast FPL decisions only — never religion, ethnicity, family, looks or money troubles; respect `/nofun`.

## How to work with me

- Work one PRD requirement ID (e.g. `L2`, `P1`) or one milestone at a time. Start non-trivial work in plan mode and show me the plan.
- After each requirement: run lint, typecheck and tests; tick it in `docs/PROGRESS.md` with a one-line note; then stop and summarise what changed and how I can try it in Telegram.
- Prefer small, boring, readable code over clever abstractions. No new dependencies without saying why.
- If something in the PRD is ambiguous, list the options with your recommended default and ask — don't guess on money or results logic.
