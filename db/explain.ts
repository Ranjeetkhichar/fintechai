/**
 * Plan check for the query that scales worst.
 *
 * Counterparty matching is `description ILIKE '%alias%'`, which no B-tree can
 * serve. This script prints the plan and says outright whether the pg_trgm GIN
 * index was used, so "we added an index" can be replaced with evidence.
 *
 * On the 10-row sample table Postgres will correctly choose a sequential scan;
 * run `npm run db:bulk` first for a meaningful answer.
 *
 * Usage: npm run db:explain
 */
import { closePool, query } from '../server/db/pool.js';

const ALIAS_QUERY = `
  SELECT COALESCE(SUM(t.transaction_amount), 0) AS total, COUNT(*) AS row_count
    FROM transaction t
    JOIN account a ON a.account_id = t.account_id
   WHERE t.transaction_date >= $1::timestamp
     AND t.transaction_date < ($2::date + 1)
     AND t.transaction_type = $3
     AND t.description ILIKE $4`;

async function main(): Promise<void> {
  const [{ count }] = await query<{ count: string }>('SELECT COUNT(*) AS count FROM transaction');
  console.log(`transaction rows: ${count}\n`);

  const rows = await query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS) ${ALIAS_QUERY}`,
    ['2021-01-01', '2026-09-05', 'debit', '%SELECTION MOBILE%']
  );

  const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
  console.log(plan);

  const usedTrigram = /idx_transaction_description_trgm|Bitmap Index Scan/i.test(plan);
  const seqScan = /Seq Scan on transaction/i.test(plan);

  console.log('\n---');
  console.log(`trigram index used : ${usedTrigram ? 'yes' : 'no'}`);
  console.log(`sequential scan    : ${seqScan ? 'yes' : 'no'}`);

  if (seqScan && Number(count) > 100_000) {
    console.log('\nA sequential scan at this size means the GIN index is missing or unusable.');
    console.log('Check that db/indexes.sql ran and that ANALYZE has been executed.');
  } else if (seqScan) {
    console.log('\nExpected on a small table: the planner reads 10 rows faster than an index.');
    console.log('Run `npm run db:bulk` and try again.');
  }
}

main()
  .catch((error) => {
    console.error('db:explain failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
