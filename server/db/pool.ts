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
 * Routes a Neon host through PgBouncer. Direct connections each take a
 * `max_connections` slot; the `-pooler` hostname does not.
 */
export function neonPooledHost(hostname: string): string {
  if (!hostname.endsWith('.neon.tech') || hostname.includes('-pooler.')) return hostname;
  return hostname.replace(/^([^.]+)\./, '$1-pooler.');
}

/**
 * Builds pool options from a connection string.
 *
 * Neon adjustments: drop `channel_binding` (libpq-only), replace `sslmode`
 * with an explicit `ssl` object, send `*.neon.tech` through the pooler, and
 * keep a single client. This process answers one question at a time; five
 * idle clients plus nodemon leftovers exhaust a small Neon compute.
 */
export function buildPoolConfig(connectionString: string): pg.PoolConfig {
  const parsedMax = Number(process.env.DB_POOL_MAX);
  const base: pg.PoolConfig = {
    max: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 1,
    // Reap before Neon / the proxy closes the socket. 0 disables reaping.
    idleTimeoutMillis: millis(process.env.DB_IDLE_TIMEOUT_MS, 60_000),
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
    url.hostname = neonPooledHost(url.hostname);

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
 * Socket and handshake failures where Postgres never returned a result.
 *
 * `query` is only used for SELECTs, so retrying these cannot duplicate work.
 * `ECONNRESET` / `EPIPE` are the usual sign that Neon (or a proxy) closed an
 * idle socket the pool still thought was live. Handshake timeouts cover a
 * cold compute waking up.
 */
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  '57P01',
  '57P02',
  '57P03',
  '08006',
  '08003',
  '53300'
]);

const RETRYABLE_MESSAGES = [
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
  'timeout exceeded when trying to connect',
  'read ECONNRESET',
  'write EPIPE',
  'socket hang up',
  'early eof',
  "Couldn't connect to compute node",
  'too many connections',
  'remaining connection slots'
];

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** True when Postgres never returned a result and a fresh socket might. */
export function isRetryable(error: unknown): boolean {
  const codes = [errorCode(error), errorCode((error as { cause?: unknown })?.cause)];
  if (codes.some((code) => code && RETRYABLE_CODES.has(code))) return true;

  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_MESSAGES.some((needle) => message.includes(needle));
}

const QUERY_ATTEMPTS = 4;

/** Wait before retry `attempt` (0-based). Immediate retry races a Neon cold start. */
export function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a parameterized query. The only way Swiss Cheese reaches the database.
 *
 * Retried with backoff when the socket died or the handshake never finished.
 * Neon terminates idle connections when the compute suspends; the next query
 * both gets ECONNRESET and has to wait for the compute to wake. A single
 * immediate retry hits that window and fails the same way.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await getPool().query<T>(text, params);
      return result.rows;
    } catch (error) {
      if (!isRetryable(error) || attempt >= QUERY_ATTEMPTS - 1) throw error;

      const delay = backoffMs(attempt);
      console.warn(
        `postgres connection dropped, retrying in ${delay}ms:`,
        (error as Error).message
      );
      await sleep(delay);
    }
  }
}

/** Closes the pool. Used by scripts, the eval harness, and process shutdown. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

/** Releases the one Postgres client so a nodemon restart does not leak it. */
export function installPoolShutdown(): void {
  const onSignal = (): void => {
    void closePool().finally(() => process.exit(0));
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2'] as const) {
    process.once(signal, onSignal);
  }
}
