# Deploying Pot Bot on Northflank

One service runs everything: the bot, the scheduled jobs, the API and the Mini App. It needs a PostgreSQL database and a public HTTPS address, and Northflank provides both.

## Before you start

1. **Replace your secrets.** The bot token and Gemini key were pasted into a chat, so make new ones:
   - In @BotFather, send `/revoke` for the bot to get a new token.
   - Create a new Gemini key in Google AI Studio.
2. **Check privacy mode is off.** In @BotFather: `/setprivacy`, choose the bot, then **Disable**.
3. **Push the code to a private GitHub repo.** Keep it private, because `fixtures/` contains your friends' names.

## 1. Create the database

1. In your Northflank project, go to **Addons → Create new addon** and choose **PostgreSQL**.
2. On the addon's settings, **turn TLS off**. The addon is private to your project, so traffic stays inside it. With TLS on, the database's certificate may be refused.
3. Open the addon's **Connection details** and find the connection string. Northflank's docs call it `POSTGRES_URI`, and one of their guides calls it `DATABASE_URL`. Use whichever your page shows.

## 2. Create the service

1. Go to **Services → Create new service → Combined service**, and connect your GitHub repo and `main` branch.
2. For the build, choose **Dockerfile**, with the path `/Dockerfile`. The first build can take 10 minutes or more.
3. Under **Resources**, keep **one instance**. Two copies would run every job twice.
4. Under **Networking**, make sure port `3000` is listed as **HTTP** and **public**. Northflank shows you a public `https://...` address for it.

## 3. Set the environment variables

| Name | Value |
| --- | --- |
| `BOT_TOKEN` | Your new bot token |
| `DATABASE_URL` | The connection string from step 1. You can link it from the addon, with `DATABASE_URL` as the name |
| `GEMINI_API_KEY` | Your new Gemini key |
| `PUBLIC_URL` | The service's `https://...` address, with nothing after it |
| `API_PORT` | `3000` |

The address only exists once the service has been created. If you have to deploy before you know it, add `PUBLIC_URL` afterwards and let the service restart.

## 4. Go live

**First, stop `pnpm dev` on your computer.** Running the bot locally removes the webhook, so the deployed bot stops getting messages. If that happens, restart the Northflank service to set it again.

Deploy, then check:

1. **Logs** show `Bot running as @office_ffm_loosers_bot with a webhook at https://...`
2. `https://<your address>/health` shows `{"status":"ok"}`
3. In Telegram, the bot has a blue **Open app** menu button, and `/app` shows a button that opens the dashboard.
4. The app shows your name or league. If it says "Open this inside Telegram", you opened the address in a normal browser instead of through the bot.

## 5. Set up your league

The database on Northflank starts empty, so your test group's league doesn't come across. Everyone claims their team again.

In your real group:

1. Add the bot and make it an admin.
2. Send `/setup 1680179`, then tap **Yes, that's us**. It starts at the next gameweek by itself.
3. Send `/settelebirr Kibrom`.
4. Reply to one of Kibrom's messages with `/coordinator`. Kibrom must press Start in a private chat with the bot.
5. Everyone taps **Claim my team**.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Logs mention a certificate or TLS error when connecting to the database | Turn TLS off on the addon, and restart |
| `Missing required settings` in the logs | Add the variable it names |
| `PUBLIC_URL must start with https://` | Fix the address, with `https://` and nothing after it |
| The bot doesn't answer | Check nothing is running locally, then restart the service to set the webhook again |
| `/health` shows `db_unavailable` | Check `DATABASE_URL` |
| The app says your session has expired | Close it and open it again from the bot |

To use your own domain later, add it in Northflank, change `PUBLIC_URL` to match, and restart.

Sources: [Deploy PostgreSQL on Northflank](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-postgresql-on-northflank), [Deploy Phoenix on Northflank](https://northflank.com/guides/deploy-phoenix-elixir-application-ci-cd-docker)
