export interface Config {
  botToken: string;
  databaseUrl: string;
  apiPort: number;
  apiHost: string;
  /** The service's public HTTPS address. With it, the bot uses a webhook and offers the Mini App. */
  publicUrl?: string;
  geminiApiKey?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const missing = ["BOT_TOKEN", "DATABASE_URL"].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required settings: ${missing.join(", ")}. Copy .env.example to .env and fill them in.`);
  }

  const apiPort = Number(env.API_PORT ?? 3000);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error(`API_PORT must be a port number, got "${env.API_PORT}".`);
  }

  if (env.PUBLIC_URL && !env.PUBLIC_URL.startsWith("https://")) {
    throw new Error("PUBLIC_URL must start with https://, because Telegram requires it.");
  }

  return {
    botToken: env.BOT_TOKEN!,
    databaseUrl: env.DATABASE_URL!,
    apiPort,
    apiHost: env.API_HOST || "127.0.0.1",
    ...(env.PUBLIC_URL ? { publicUrl: env.PUBLIC_URL.replace(/\/+$/, "") } : {}),
    ...(env.GEMINI_API_KEY ? { geminiApiKey: env.GEMINI_API_KEY } : {}),
  };
}
