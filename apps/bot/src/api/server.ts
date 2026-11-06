import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type RouteHandlerMethod } from "fastify";

export interface ApiDeps {
  checkDb: () => Promise<void>;
  /** The built Mini App. Skipped if it isn't there, as in development, where Vite serves it. */
  webDir?: string;
  telegramWebhook?: { path: string; handler: RouteHandlerMethod };
  /** Adds the Mini App's /api routes. */
  routes?: (api: FastifyInstance) => Promise<void>;
}

export async function createApi({ checkDb, webDir, telegramWebhook, routes }: ApiDeps): Promise<FastifyInstance> {
  const api = Fastify({ logger: false });

  api.get("/health", async (_request, reply) => {
    try {
      await checkDb();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  if (telegramWebhook) api.post(telegramWebhook.path, telegramWebhook.handler);
  if (routes) await api.register(routes, { prefix: "/api" });
  if (webDir && existsSync(webDir)) await api.register(fastifyStatic, { root: webDir });

  return api;
}
