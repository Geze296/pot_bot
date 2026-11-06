export interface DbOptions {
  /** A private certificate authority, as hosted databases like Aiven use. PEM text. */
  caCert?: string;
}

export interface PgConnection {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
}

/**
 * How to reach Postgres through node-postgres, for both Prisma and the job queue. With a private certificate, sslmode
 * has to leave the URL: node-postgres lets it override the ssl settings, which would throw the certificate away.
 * The certificate is still fully checked. Prisma's migrate tool reads the original URL, so it isn't affected.
 */
export function pgConnection(databaseUrl: string, caCert?: string): PgConnection {
  if (!caCert) return { connectionString: databaseUrl };

  const url = new URL(databaseUrl);
  url.searchParams.delete("sslmode");
  // Hosts often store a certificate's line breaks as the two characters \\n.
  return { connectionString: url.toString(), ssl: { ca: caCert.replace(/\\n/g, "\n"), rejectUnauthorized: true } };
}
