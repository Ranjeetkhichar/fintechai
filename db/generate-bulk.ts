/**
 * Synthetic volume generator, for proving the query plans hold at scale.
 *
 * Two constraints keep the gold set intact, and both matter:
 *   1. Generated rows land strictly before 2025-12-01, outside every window in
 *      docs/EXAMPLES.md.
 *   2. Every generated row carries a reference number, so the missing-reference
 *      gold answer stays at exactly one row.
 *
 * Break either and `npm run eval` will start failing for the wrong reason.
 *
 * Usage: npm run db:bulk -- --rows=1000000
 */
import { closePool, getPool, query } from '../server/db/pool.js';

const HARD_CEILING = '2025-12-01';

interface Options {
  rows: number;
  batch: number;
  from: string;
  to: string;
  seed: number;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string, fallback: string) => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };

  return {
    rows: Number(get('rows', '1000000')),
    batch: Number(get('batch', '2000')),
    from: get('from', '2021-01-01'),
    to: get('to', '2025-11-30'),
    seed: Number(get('seed', '20260905'))
  };
}

/** Deterministic PRNG so two runs produce the same table. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Real statement shapes from the sample data, with the counterparty swapped. */
const TEMPLATES = [
  (name: string, n: number) => `FT -  ${9000000 + n} -  50200013729069 - ${name}`,
  (name: string, n: number) => `UPI-${name}-XXXXXX${1000 + (n % 9000)}-AUBL0002125-${100000000000 + n}`,
  (name: string, n: number) => `NEFT  - UTIB0002678 - ${95000000 + n} - 915020031685136 - ${name}`,
  (name: string, n: number) => `IMPS/P2A/${600000000000 + n}/UTIB/918020101986700/00/INET/9211/${name}`,
  (name: string, n: number) => `R/RATNR5${n}/ZBFLCTP405PBL15667333//${name}/RATNR5${n}`
];

const COUNTERPARTIES = [
  'SELECTION MOBILE',
  'SELECTION ELECTRONICS   DAHISAR EAST',
  'NAVYUG SELECTION',
  'UMANG SELECTIONHAPURBPES DPF10129',
  'RELIANCEDIGITAL RETAIL LTD   SELECT CITY SAKET DELHI',
  'SELECTRICITY TWO PRIVATE LIMITED',
  'SELECTIONMALIGAI',
  'PARESH VIKRANT GHASE',
  'GAUTAM SINGH',
  'ANANTA LOGISTICS PRIVATE LIMITED'
];

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 19).replace('T', ' ');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.to >= HARD_CEILING) {
    throw new Error(
      `--to must stay before ${HARD_CEILING}. Generated rows inside the gold windows would break docs/EXAMPLES.md.`
    );
  }

  const accounts = await query<{ account_id: string }>('SELECT account_id FROM account ORDER BY account_id');
  if (!accounts.length) throw new Error('No accounts found. Run npm run db:setup first.');

  const random = mulberry32(options.seed);
  const fromTime = Date.parse(`${options.from}T00:00:00Z`);
  const toTime = Date.parse(`${options.to}T23:59:59Z`);
  const span = toTime - fromTime;

  const pool = getPool();
  const started = Date.now();
  let written = 0;

  console.log(`generating ${options.rows} rows between ${options.from} and ${options.to}`);

  while (written < options.rows) {
    const size = Math.min(options.batch, options.rows - written);
    const values: unknown[] = [];
    const tuples: string[] = [];

    for (let i = 0; i < size; i += 1) {
      const n = written + i;
      const name = COUNTERPARTIES[Math.floor(random() * COUNTERPARTIES.length)];
      const template = TEMPLATES[Math.floor(random() * TEMPLATES.length)];
      const account = accounts[Math.floor(random() * accounts.length)].account_id;
      const isCredit = random() < 0.18;
      const amount = (Math.floor(random() * 250000) + 100 + random()).toFixed(2);

      const base = values.length;
      tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, NULL)`);
      values.push(
        `bulk-${options.seed}-${n}`,
        account,
        isoDay(fromTime + Math.floor(random() * span)),
        isCredit ? 'credit' : 'debit',
        template(name, n),
        amount,
        `BULK${options.seed}${n}`
      );
    }

    await pool.query(
      `INSERT INTO transaction (transaction_id, account_id, transaction_date, transaction_type,
                                description, transaction_amount, transaction_reference_id, utr_number)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (transaction_id) DO NOTHING`,
      values
    );

    written += size;
    if (written % (options.batch * 25) === 0 || written === options.rows) {
      const rate = Math.round(written / ((Date.now() - started) / 1000));
      console.log(`  ${written}/${options.rows} rows (${rate}/s)`);
    }
  }

  await pool.query('ANALYZE transaction');
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s. Run npm run db:explain to check the plan.`);
}

main()
  .catch((error) => {
    console.error('db:bulk failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
