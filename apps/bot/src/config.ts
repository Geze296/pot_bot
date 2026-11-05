export interface Config {
  botToken: string;
  databaseUrl: string;
  apiPort: number;
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

  return { botToken: env.BOT_TOKEN!, databaseUrl: env.DATABASE_URL!, apiPort };
}
