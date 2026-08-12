import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

const { Pool } = pg;

// Central place that turns a DATABASE_URL into a pg Pool. Kept tiny and
// env-decoupled (reads process.env at call time, never through config/env.js) so
// it can run in secretless unit CI without tripping the fail-fast token check.
//
// SSL policy: the URL stays canonical (e.g. Supabase's `...?sslmode=require`,
// which the Supabase CLI also consumes), and we normalise TLS here. Supabase's
// pooler presents a chain Node's default trust store rejects ("self-signed
// certificate in certificate chain"), so when the URL asks for SSL we keep
// encryption on but relax verification. A plain local/CI Postgres URL (no
// sslmode) gets no SSL, which is exactly what the ephemeral test container wants.
export function createPool(connectionString = process.env.DATABASE_URL, options = {}) {
  if (!connectionString) {
    throw new Error('createPool: no connection string (set DATABASE_URL)');
  }

  const parsed = parseConnectionString(connectionString);
  const wantsSsl = Boolean(parsed.ssl);

  return new Pool({
    ...parsed,
    // parse() gives port as a string; pg wants a number.
    port: parsed.port ? Number(parsed.port) : undefined,
    ssl: wantsSsl ? { rejectUnauthorized: false } : false,
    max: 5,
    ...options
  });
}
