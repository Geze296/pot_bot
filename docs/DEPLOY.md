# Deploying Pot Bot

Pot Bot is deployed on **Fly.io**, with the database on **Aiven**. The Fly steps come first. Render is kept below as a free alternative.

## Fly.io and Aiven

Fly.io has no free plan, so this costs a few dollars a month for one always-on machine with 512 MB. Check Fly's pricing page for the current figure. `fly.toml` is already set up.

1. **Install `flyctl`** and log in:
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```
2. **Create the database on Aiven**, as in [section 1 below](#1-create-the-database-on-aiven).
3. **Set the secrets.** For the certificate, use the file you downloaded from Aiven:
   ```bash
   fly secrets set BOT_TOKEN='your new token' DATABASE_URL='Aiven Service URI'
   fly secrets set DATABASE_CA_CERT="$(cat ca.pem)"
   fly secrets set GEMINI_API_KEY='your key'   # optional
   ```
4. **Stop `pnpm dev` on your computer,** then deploy:
   ```bash
   fly deploy
   fly scale count 1
   ```
   Fly may start two machines by default, and two copies would run every job twice. `fly scale count 1` keeps one.
5. **Check it:**
   ```bash
   fly status
   fly logs
   ```
   The logs should show `Bot running as @office_ffm_loosers_bot with a webhook at https://pot-bot.fly.dev`, and `https://pot-bot.fly.dev/health` should show `{"status":"ok"}`.
6. **Test in a test group:** `/start` in private, `/setup 1680179` in the group, then `/app`. That also shows whether FPL allows Fly's servers.

If you rename the app in `fly.toml`, change `PUBLIC_URL` to match.

Then continue from [section 5](#5-set-up-your-real-league) to set up your real league, and set up backups as in [section 6](#6-back-up-your-data).

| What you see | What to do |
| --- | --- |
| `fly deploy` fails while building | Retry once, then send me the build log |
| The health check fails | Run `fly logs`. Check `fly.toml` still says `internal_port = 3000` |
| `Missing required settings` | Set the secret it names with `fly secrets set` |
| `self-signed certificate` or `unable to verify` | Set `DATABASE_CA_CERT` again from the certificate file |
| Out of memory | Raise `memory` in `fly.toml` to `1gb`, and deploy again |
| Jobs or replies stop | Run `fly status`. The machine should be `started`, with exactly one machine |

---

# Render and Aiven, a free alternative

Render runs the service: the bot, the scheduled jobs, the API and the Mini App. Aiven runs PostgreSQL. A free monitor keeps Render awake. As far as their docs say, none of the three needs a card, but sources conflict on Render for Docker services.

**Know the trade-off:** Render's free plan sleeps after 15 minutes without traffic, and no scheduled job runs while it sleeps. The monitor prevents that, but Render doesn't support this trick and could stop allowing it. Reminders could then arrive late or be skipped, though the bot wouldn't send duplicates. If it fails, the app can move anywhere that runs Docker.

## Before you start

1. **Replace your secrets.** The bot token and Gemini key were pasted into a chat. In @BotFather, send `/revoke` for a new token, and create a new Gemini key in Google AI Studio. If either was ever stored on Northflank, this is essential, because Northflank disclosed a breach on 30 October 2026.
2. **Check privacy mode is off.** In @BotFather: `/setprivacy`, choose the bot, then **Disable**.
3. **Push the code to a private GitHub repo.** Keep it private, because `fixtures/` contains your friends' names:
   ```bash
   git remote add origin https://github.com/YOUR_NAME/pot-bot.git
   git push -u origin main
   ```
4. **Decide about Gemini.** Gemini's free terms say not to submit personal information, and the bot sends it Telebirr screenshots and member names. With no key, every screenshot goes to the coordinator to approve, and banter uses templates.

## 1. Create the database on Aiven

1. Sign up at https://aiven.io and create a **PostgreSQL** service on the **Free** plan.
2. On the service's overview page, copy two things:
   - the **Service URI**, which looks like `postgres://avnadmin:...@....aivencloud.com:12345/defaultdb?sslmode=require`
   - the **CA certificate**: use Show or Download, and keep the whole text

Keep `sslmode=require` in the URI. Aiven's free plan allows 20 connections, and the bot uses about 8.

## 2. Create the service on Render

1. Sign up at https://render.com and connect your GitHub account.
2. Choose **New → Web Service**, then your repo.
3. Set **Language** to **Docker**, and **Instance Type** to **Free**.
4. Under **Advanced**, set **Health Check Path** to `/health`.
5. Add these environment variables:

| Name | Value |
| --- | --- |
| `BOT_TOKEN` | Your new bot token |
| `DATABASE_URL` | The Service URI from Aiven |
| `DATABASE_CA_CERT` | The whole CA certificate from Aiven |
| `GEMINI_API_KEY` | Your new key, or leave it out |

You don't need `PUBLIC_URL` or a port, because Render provides them. The first build can take 10 minutes or more.

## 3. Keep it awake

1. Sign up for a free monitor such as https://uptimerobot.com.
2. Add an **HTTP(s)** monitor for `https://YOUR-SERVICE.onrender.com/health`, every **5 minutes**.
3. Turn on email alerts. If `/health` fails, the bot or database has a problem, so this tells you about real faults too.

## 4. Go live

**First, stop `pnpm dev` on your computer.** Running the bot locally removes the webhook, so the deployed bot stops getting messages. If that happens, use **Manual Deploy → Restart service** on Render to set it again.

Then check, in this order:

1. **Render's logs** show `Bot running as @office_ffm_loosers_bot with a webhook at https://...`
2. `https://YOUR-SERVICE.onrender.com/health` shows `{"status":"ok"}`
3. **Telegram works:** send `/start` to the bot in private.
4. **FPL works from Render's servers:** in a **test group**, send `/setup 1680179`. If it says it can't reach FPL, try again later, then send me the logs. An FPL 403 means it's refusing this host.
5. **The app works:** send `/app` in private, and open it.
6. **Leave it for a day.** On UptimeRobot, the monitor should stay up. In the test league, reminders should arrive on time.

Run a test league through a live gameweek before moving your real group.

## 5. Set up your real league

The database starts empty, so your local test league doesn't come across, and everyone claims their team again.

In your real group:

1. Add the bot and make it an admin.
2. Send `/setup 1680179`, then tap **Yes, that's us**. It starts at the next gameweek by itself.
3. Send `/settelebirr Kibrom`.
4. Reply to one of Kibrom's messages with `/coordinator`. Kibrom must press Start in a private chat with the bot, and claim his team.
5. Everyone taps **Claim my team**.

## 6. Back up your data

Aiven's free plan includes backups, but its retention isn't clearly stated, and free plans can change. Every so often, or from a scheduled job, save a copy on your own computer, using the Service URI:

```bash
docker compose exec -T db pg_dump "SERVICE_URI" | gzip > potbot-$(date +%F).sql.gz
```

Try restoring one into a local database once, so you know it works.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| The build fails or runs out of time | Retry it, then send me the log. The image is about 1.1 GB, and Render's build limits aren't published |
| Render asks for a card | That's the reported Docker requirement. Tell me, because we'd need another plan |
| `self-signed certificate` or `unable to verify` in the logs | Check `DATABASE_CA_CERT` holds the whole certificate, including the BEGIN and END lines |
| `too many connections` | Check nothing else is using this database, then restart the service |
| `Missing required settings` | Add the variable it names |
| The bot doesn't answer | Check nothing is running locally, then restart the service to set the webhook again |
| Out of memory | Tested at about 256 MB here, so send me the logs. Render's free memory limit isn't confirmed |
| `/health` shows `db_unavailable` | Check `DATABASE_URL`, and whether Aiven has powered the service off. It can do that with "no continuative activity" |
| Replies are slow after a quiet spell | Render was asleep. Check the monitor is running |
| The app says your session has expired | Close it, and open it again from the bot |

Run only one copy of the bot on any host. Two would run every job twice.
