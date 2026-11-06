# Pot Bot

A Telegram bot and Mini App that runs a weekly paid Fantasy Premier League mini-league for a group of friends. It imports your league from FPL, checks Telebirr screenshots, reminds people who haven't paid, settles each gameweek by itself, and keeps the group chat entertained.

**The bot never holds or sends money.** Friends pay the coordinator on Telebirr, and the coordinator pays the winner. The bot only tracks and checks.

## What it does

- **Payments:** a member sends a Telebirr screenshot, and the bot reads it, checks it and tells the group. Anything it can't confirm goes to the coordinator.
- **Reminders:** in the group and by private message, from 2 days before the deadline, to people who haven't paid.
- **Results:** once FPL's scores are final, it posts the winner, the runner-up's free pass, the pot and weekly awards.
- **Mini App:** dashboard, live table, results, ledger, and screens for managing payments, members, rules and the audit log.
- **AI persona:** optional. With a Gemini key it writes recaps and roasts about FPL decisions. Without one, it uses plain templates.

Send `/help` to the bot for the member commands, and `/admin` for the owner's and coordinator's.

## Run it locally

You need Node.js 22.12 or newer, pnpm and Docker.

```bash
pnpm install
cp .env.example .env            # then set BOT_TOKEN
docker compose up -d db
pnpm db:deploy
pnpm dev
```

In @BotFather, create the bot with `/newbot`, then send `/setprivacy` and choose **Disable**, so it can see group photos.

Add the bot to a group as an admin, then send `/setup <your FPL league ID or standings link>`. To find the ID, open your league's standings on the FPL site. The address looks like `/leagues/123456/standings/c`. Invite links won't work.

## Try the Mini App locally

Telegram only opens Mini Apps over HTTPS, so you need a tunnel:

```bash
pnpm build
cloudflared tunnel --protocol http2 --url http://localhost:3000
```

Put the address it prints in `.env` as `PUBLIC_URL`, restart `pnpm dev`, and send `/app` to the bot in private. If the tunnel doesn't print `Registered tunnel connection`, your network is blocking it, so try another one.

Each new tunnel gets a new address. When you finish, remove `PUBLIC_URL` and restart.

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md) for step-by-step instructions for Northflank. Any host that runs Docker works with `docker compose up -d --build`.

## Develop

```bash
pnpm test                       # needs the database running, and uses its own schema
pnpm lint && pnpm typecheck
```

| Folder | What's in it |
| --- | --- |
| `apps/bot` | The Telegram bot, the scheduled jobs and the Mini App's API |
| `apps/web` | The Mini App |
| `packages/core` | Rules, pot maths, ties, free passes and awards, with no I/O |
| `packages/fpl` | The FPL API client |
| `packages/payments` | Screenshot checks |
| `packages/ai` | Gemini, personas and guardrails |
| `packages/db` | The Prisma schema and migrations |
| `locales` | Every message the bot and the app show |
| `personas` | The AI's voices, one file each |

`docs/PRD.md` and `docs/SPEC.md` describe the product. `docs/PROGRESS.md` tracks what's built and the decisions behind it.
