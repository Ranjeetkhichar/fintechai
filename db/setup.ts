/**
 * Creates the Swiss Cheese schema, loads the sample rows, builds indexes, then prints a
 * short sanity report. The report exists so a human can eyeball the headline
 * figures against docs/EXAMPLES.md before any model is involved.
 *
 * Usage: npm run db:setup
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool, query } from '../server/db/pool.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Executes one .sql file as a single multi-statement batch. */
async function runFile(name: string): Promise<void> {
  const sql = await readFile(join(here, name), 'utf8');
  await getPool().query(sql);
  console.log(`  applied ${name}`);
}

/** Prints the figures most likely to drift, so mismatches surface immediately. */
async function sanityReport(): Promise<void> {
  const [counts] = await query<{ banks: string; accounts: string; txs: string }>(
    `SELECT (SELECT COUNT(*) FROM bank)        AS banks,
            (SELECT COUNT(*) FROM account)     AS accounts,
            (SELECT COUNT(*) FROM transaction) AS txs`
  );
  console.log(`\nrows: ${counts.banks} banks, ${counts.accounts} accounts, ${counts.txs} transactions`);

  const [cash] = await query<{ total: string }>(
    `SELECT SUM(available_balance) AS total FROM account`
  );
  console.log(`cash position total      : ${cash.total}   (expected -81229672.84)`);

  const [june] = await query<{ total: string; rows: string }>(
    `SELECT COALESCE(SUM(transaction_amount), 0) AS total, COUNT(*) AS rows
       FROM transaction
      WHERE transaction_type = 'debit'
        AND transaction_date >= '2026-06-01'
        AND transaction_date <  '2026-07-01'`
  );
  console.log(`June 2026 outflow        : ${june.total} over ${june.rows} rows   (expected 169299.00 / 4)`);

  const [may] = await query<{ total: string; rows: string }>(
    `SELECT COALESCE(SUM(transaction_amount), 0) AS total, COUNT(*) AS rows
       FROM transaction
      WHERE transaction_type = 'debit'
        AND transaction_date >= '2026-05-01'
        AND transaction_date <  '2026-06-01'`
  );
  console.log(`May 2026 outflow         : ${may.total} over ${may.rows} rows   (expected 71156.00 / 2)`);

  const [ytd] = await query<{ total: string; rows: string }>(
    `SELECT COALESCE(SUM(transaction_amount), 0) AS total, COUNT(*) AS rows
       FROM transaction
      WHERE transaction_type = 'debit'
        AND transaction_date >= '2026-04-01'
        AND transaction_date <  '2026-09-06'`
  );
  console.log(`FY26-27 YTD outflow      : ${ytd.total} over ${ytd.rows} rows   (expected 240455.00 / 6)`);

  const [mobile] = await query<{ total: string; rows: string }>(
    `SELECT COALESCE(SUM(transaction_amount), 0) AS total, COUNT(*) AS rows
       FROM transaction
      WHERE transaction_type = 'debit'
        AND description ILIKE '%SELECTION MOBILE%'
        AND transaction_date >= '2026-06-01'
        AND transaction_date <  '2026-07-01'`
  );
  console.log(`Selection Mobile in June : ${mobile.total} over ${mobile.rows} rows   (expected 146474.00 / 2)`);

  const [missing] = await query<{ rows: string }>(
    `SELECT COUNT(*) AS rows FROM transaction WHERE transaction_reference_id IS NULL`
  );
  console.log(`missing reference rows   : ${missing.rows}   (expected 1)`);
}

async function main(): Promise<void> {
  console.log('setting up swiss cheese database');
  await runFile('schema.sql');
  await runFile('seed.sql');
  await runFile('indexes.sql');
  await sanityReport();
  console.log('\ndone. Run `npm run eval -- --slots=gold` for the full gold check.');
}

main()
  .catch((error) => {
    console.error('db:setup failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
