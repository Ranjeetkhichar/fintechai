/**
 * Connection diagnostic.
 *
 * Isolates "can Swiss Cheese reach Postgres at all" from everything the setup script
 * does afterwards, and translates the usual driver errors into the thing that
 * is actually wrong.
 *
 * Usage: npm run db:ping
 */
import { closePool, describeConnection, query } from '../server/db/pool.js';

interface Diagnosis {
  cause: string;
  fixes: string[];
}

/** Maps a driver error to a likely cause. Ordered most specific first. */
function diagnose(error: NodeJS.ErrnoException): Diagnosis {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (code === 'ECONNRESET' || /socket hang up/i.test(message)) {
    return {
      cause: 'The server accepted the socket and then closed it, before Postgres said anything.',
      fixes: [
        'Open the Neon console and check the project still exists and the branch is not deleted.',
        'If the compute is suspended, run any query from the Neon SQL editor once to wake it, then retry.',
        'If you rotated the password, DB_CONNECTION_STRING in .env is stale. Copy the current string from Neon.',
        'If you are on a VPN or corporate network, try without it. TLS interception resets Neon connections.'
      ]
    };
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      cause: 'The hostname did not resolve.',
      fixes: ['Check the host in DB_CONNECTION_STRING for a typo.', 'Check general DNS and network access.']
    };
  }

  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return {
      cause: 'The connection attempt timed out.',
      fixes: ['A firewall is likely blocking outbound 5432.', 'Raise DB_CONNECT_TIMEOUT_MS if the Neon compute is cold.']
    };
  }

  if (/password authentication failed/i.test(message) || code === '28P01') {
    return {
      cause: 'Postgres rejected the credentials.',
      fixes: ['Copy a fresh connection string from the Neon console into .env.']
    };
  }

  if (/database .* does not exist/i.test(message) || code === '3D000') {
    return {
      cause: 'The database name in the connection string does not exist on that host.',
      fixes: ['Check the path segment of DB_CONNECTION_STRING, usually /neondb.']
    };
  }

  if (/self-signed|certificate|unable to verify/i.test(message)) {
    return {
      cause: 'The TLS certificate could not be verified.',
      fixes: [
        'You are probably behind a TLS-intercepting proxy.',
        'To confirm only, set DB_SSL_INSECURE=true in .env and retry. Do not leave it set.'
      ]
    };
  }

  return { cause: message || 'Unknown driver error.', fixes: ['Run with --trace-warnings for more detail.'] };
}

async function main(): Promise<void> {
  const summary = describeConnection(process.env.DB_CONNECTION_STRING ?? '');

  if (!summary) {
    console.error('DB_CONNECTION_STRING is missing or not a valid URL.');
    process.exitCode = 1;
    return;
  }

  console.log(`host     : ${summary.host}`);
  console.log(`database : ${summary.database}`);
  console.log(`user     : ${summary.user}`);
  console.log(`params   : ${summary.params.join(', ') || 'none'}`);
  console.log('\nconnecting...');

  const started = Date.now();

  try {
    const [row] = await query<{ version: string; now: string }>(
      'SELECT version() AS version, now()::text AS now'
    );
    console.log(`\nconnected in ${Date.now() - started} ms`);
    console.log(row.version);
    console.log(`server time: ${row.now}`);

    const [trgm] = await query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS installed`
    );
    console.log(`pg_trgm installed: ${trgm.installed ? 'yes' : 'no (db:setup will add it)'}`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const { cause, fixes } = diagnose(err);

    console.error(`\nfailed after ${Date.now() - started} ms`);
    console.error(`error: ${err.code ? `${err.code} ` : ''}${err.message}`);
    console.error(`\n${cause}\n`);
    fixes.forEach((fix, index) => console.error(`  ${index + 1}. ${fix}`));

    process.exitCode = 1;
  }
}

main().finally(closePool);
