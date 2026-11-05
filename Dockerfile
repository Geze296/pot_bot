FROM node:22-bookworm-slim

# Prisma's migration engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

WORKDIR /app
COPY . .
# The bot runs from TypeScript with tsx, so dev dependencies stay in the image.
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
# Migrations are safe to repeat. exec lets the bot receive the stop signal and shut down cleanly.
CMD ["sh", "-c", "pnpm db:deploy && exec node --import tsx apps/bot/src/index.ts"]
