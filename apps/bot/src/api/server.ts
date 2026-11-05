import Fastify, { type FastifyInstance } from "fastify";

export interface ApiDeps {
  checkDb: () => Promise<void>;
}

export function createApi({ checkDb }: ApiDeps): FastifyInstance {
  const api = Fastify({ logger: false });

  api.get("/health", async (_request, reply) => {
    try {
      await checkDb();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });

  return api;
}
