import pg from 'pg';
import type { Pool as PgPool, QueryResultRow } from 'pg';

/**
 * Single Postgres pool for the whole process.
 *
 * Money never becomes a JS number. node-postgres parses NUMERIC as a string by
 * default; we keep it that way and format from the decimal string, so a total
 * cannot lose precision on the way to the user.
 */
const { Pool, types } = pg;

// 1700 = NUMERIC. Identity parser, stated explicitly so nobody "fixes" it later.
types.setTypeParser(1700, (value: string) => value);
// 1114 = TIMESTAMP WITHOUT TIME ZONE. Keep the raw string; the dataset carries
// no zone and re-interpreting it in local time would shift dates.
types.setTypeParser(1114, (value: string) => value);

let pool: PgPool | null = null;

/** Host, database and user for error messages. Never the password. */
export interface ConnectionSummary {
  host: string;
  database: string;
  user: string;
  params: string[];
}

export function describeConnection(connectionString: string): ConnectionSummary | null {
  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      database: url.pathname.replace(/^\//, ''),
      user: decodeURIComponent(url.username),
      params: [...url.searchParams.keys()]
    };
  } catch {
    return null;
  }
}

/** Reads a millisecond setting, keeping an explicit 0 distinct from "unset". */
function millis(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Builds pool options from a connection string.
 *
 * Two Neon-specific adjustments. `channel_binding` is a libpq parameter that
 * node-postgres does not implement, and leaving it in the string has been known
 * to abort the handshake. `sslmode` is dropped in favour of an explicit `ssl`
 * object, which also silences the pg v9 deprecation warning about `require`
 * quietly meaning `verify-full`.
 */
function buildPoolConfig(connectionString: string): pg.PoolConfig {
  const base: pg.PoolConfig = {
    max: Number(process.env.DB_POOL_MAX || 5),
    // Long idle window on purpose. Reaping a socket after 30s meant nearly every
    // question paid for a fresh TLS handshake to a remote Neon endpoint, which is
    // what runs past connectionTimeoutMillis. 0 disables reaping entirely.
    idleTimeoutMillis: millis(process.env.DB_IDLE_TIMEOUT_MS, 300_000),
    // Generous enough for a suspended Neon compute to wake and finish a handshake.
    connectionTimeoutMillis: millis(process.env.DB_CONNECT_TIMEOUT_MS, 30_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000
  };

  // Debug escape hatch for a corporate TLS proxy. Not for normal use.
  const rejectUnauthorized = process.env.DB_SSL_INSECURE !== 'true';

  try {
    const url = new URL(connectionString);
    url.searchParams.delete('channel_binding');
    url.searchParams.delete('sslmode');

    return {
      ...base,
      connectionString: url.toString(),
      ssl: { rejectUnauthorized, servername: url.hostname }
    };
  } catch {
    // Unparseable string: hand it to pg as-is and let it report the problem.
    return { ...base, connectionString };
  }
}

/** Lazily creates the shared pool so tests can run without a database. */
export function getPool(): PgPool {
  if (pool) return pool;

  const connectionString = process.env.DB_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error(
      'DB_CONNECTION_STRING is not set. Copy .env.example to .env and fill it in.'
    );
  }

  pool = new Pool(buildPoolConfig(connectionString));

  // A pooled connection can die between checkouts. Without this listener the
  // error is emitted on the pool and crashes the process.
  pool.on('error', (error) => {
    console.error('postgres pool error:', error.message);
  });

  return pool;
}

/**
 * Connect-phase failures, i.e. the pool never handed us a live client so the
 * statement provably never reached Postgres. Retrying one of these cannot
 * duplicate work. Errors raised once a query is in flight are not listed here.
 */
const CONNECT_FAILURES = [
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH'
];

function isConnectFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return CONNECT_FAILURES.some((needle) => message.includes(needle));
}

/**
 * Runs a parameterized query. The only way Swiss Cheese reaches the database.
 *
 * Retried once, and only when the pool failed to open a connection at all. The
 * first request after an idle spell is the one that wakes a suspended compute,
 * and losing the user's answer to that is not acceptable.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const result = await getPool().query<T>(text, params);
    return result.rows;
  } catch (error) {
    if (!isConnectFailure(error)) throw error;

    console.warn('postgres connect failed, retrying once:', (error as Error).message);
    const result = await getPool().query<T>(text, params);
    return result.rows;
  }
}

/** Closes the pool. Used by scripts and the eval harness so they can exit. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
