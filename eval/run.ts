/**
 * The eval harness.
 *
 * Two modes, and the separation is the point:
 *   --slots=gold   hand-written slots, no model. A failure means the SQL,
 *                  masking or policy is wrong.
 *   --slots=model  the real NLU. A failure means intent or slot extraction is
 *                  wrong.
 *
 * A number regression and a language regression therefore never look alike,
 * and any model can be scored on the same fixed questions.
 *
 * Usage:
 *   npm run eval
 *   npm run eval -- --slots=model --model=qwen3.8:27b --verbalize
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool } from '../server/db/pool.js';
import { clearBankCache } from '../server/pipeline/resolve/banks.js';
import { resolveSlots } from '../server/pipeline/resolve/slots.js';
import { runPipeline } from '../server/pipeline/index.js';
import { ResilientChatModel, type ChatModel } from '../server/pipeline/model.js';
import { fallbackSentence } from '../server/pipeline/verbalize.js';
import { asOf } from '../server/pipeline/clock.js';
import { GOLD_CASES, SENSITIVE_STRINGS, type GoldCase } from './cases.js';
import type { ModelSlots, Slots } from '../server/pipeline/types.js';

const here = dirname(fileURLToPath(import.meta.url));

interface Options {
  mode: 'gold' | 'model';
  service?: string;
  model?: string;
  verbalize: boolean;
  out?: string;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string) => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const slots = get('slots');
  return {
    mode: slots === 'model' ? 'model' : 'gold',
    service: get('service'),
    model: get('model'),
    verbalize: argv.includes('--verbalize'),
    out: get('out')
  };
}

interface CaseScore {
  id: string;
  question: string;
  intentOk: boolean;
  kindOk: boolean;
  amountsOk: boolean;
  containsOk: boolean;
  rowCountOk: boolean;
  slotsOk: boolean;
  leaked: string[];
  durationMs: number;
  actualIntent: string;
  actualKind: string;
  missing: string[];
  sentence: string;
  error?: string;
}

/** Key resolved fields. Comparing these tells us whether NLU matched gold. */
function slotFingerprint(slots: Slots): string {
  return JSON.stringify({
    intent: slots.intent,
    from: slots.dateFrom ?? null,
    to: slots.dateTo ?? null,
    bank: slots.bankCode ?? null,
    type: slots.txType ?? null,
    counterparty: slots.counterpartyKey ?? null,
    candidates: slots.counterpartyCandidates ?? null,
    reference: slots.reference ?? null
  });
}

async function scoreCase(
  testCase: GoldCase,
  options: Options,
  chatModel: ChatModel | null,
  previousGold: Slots | null,
  previousActual: Slots | null
): Promise<{ score: CaseScore; goldSlots: Slots; actualSlots: Slots }> {
  const started = Date.now();

  // Gold resolution always runs: in model mode it is the yardstick.
  const gold = await resolveSlots(testCase.question, testCase.goldSlots, previousGold);

  let modelSlots: ModelSlots = testCase.goldSlots;
  if (options.mode === 'model' && chatModel) {
    const call = await chatModel.fillSlots(testCase.question, previousActual);
    modelSlots = call.slots;
  }

  const result = await runPipeline(testCase.question, modelSlots, previousActual);

  let sentence = fallbackSentence(result.payload);
  if (options.verbalize && chatModel) {
    try {
      sentence = (await chatModel.verbalize(result.payload)).text || sentence;
    } catch (error) {
      sentence = `${sentence} [verbalizer failed: ${(error as Error).message}]`;
    }
  }

  const serialized = `${JSON.stringify(result.payload)} ${sentence}`;
  const missing: string[] = [];

  for (const amount of testCase.expectAmounts ?? []) {
    if (!serialized.includes(amount)) missing.push(`amount ${amount}`);
  }
  for (const text of testCase.expectContains ?? []) {
    if (!serialized.toLowerCase().includes(text.toLowerCase())) missing.push(`text "${text}"`);
  }

  const leaked = SENSITIVE_STRINGS.filter((secret) => serialized.includes(secret));

  const score: CaseScore = {
    id: testCase.id,
    question: testCase.question,
    intentOk: result.payload.intent === testCase.expectIntent,
    kindOk: result.payload.kind === testCase.expectKind,
    amountsOk: (testCase.expectAmounts ?? []).every((amount) => serialized.includes(amount)),
    containsOk: (testCase.expectContains ?? []).every((text) =>
      serialized.toLowerCase().includes(text.toLowerCase())
    ),
    rowCountOk:
      testCase.expectRowCount === undefined || result.payload.trail.rowCount === testCase.expectRowCount,
    slotsOk: slotFingerprint(gold.slots) === slotFingerprint(result.slots),
    leaked,
    durationMs: Date.now() - started,
    actualIntent: result.payload.intent,
    actualKind: result.payload.kind,
    missing,
    sentence
  };

  return { score, goldSlots: gold.slots, actualSlots: result.slots };
}

function tick(value: boolean): string {
  return value ? 'pass' : 'FAIL';
}

function buildScorecard(scores: CaseScore[], options: Options, modelName: string): string {
  const total = scores.length;
  const count = (predicate: (score: CaseScore) => boolean) => scores.filter(predicate).length;

  const numbers = count((s) => s.amountsOk && s.containsOk);
  const intents = count((s) => s.intentOk);
  const kinds = count((s) => s.kindOk);
  const rows = count((s) => s.rowCountOk);
  const slots = count((s) => s.slotsOk);
  const clean = count((s) => s.leaked.length === 0);
  const passed = count(
    (s) => s.intentOk && s.kindOk && s.amountsOk && s.containsOk && s.rowCountOk && s.leaked.length === 0 && !s.error
  );

  const latencies = scores.map((s) => s.durationMs).sort((a, b) => a - b);
  const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0;
  const slowest = latencies.length ? latencies[latencies.length - 1] : 0;

  const lines: string[] = [];
  lines.push(`# Swiss Cheese eval scorecard`);
  lines.push('');
  lines.push(`- Mode: \`--slots=${options.mode}\``);
  lines.push(`- Model: \`${options.mode === 'gold' ? 'none (deterministic core only)' : modelName}\``);
  lines.push(`- Verbalizer: ${options.verbalize ? 'model' : 'deterministic fallback'}`);
  lines.push(`- As of: ${asOf()}`);
  lines.push(`- Run: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push('| Dimension | Score |');
  lines.push('|---|---|');
  lines.push(`| Cases fully passing | ${passed}/${total} |`);
  lines.push(`| Intent correct | ${intents}/${total} |`);
  lines.push(`| Outcome kind correct (answer/clarify/refuse/empty) | ${kinds}/${total} |`);
  lines.push(`| Numbers exact | ${numbers}/${total} |`);
  lines.push(`| Row count correct | ${rows}/${total} |`);
  lines.push(`| Slots match gold | ${slots}/${total} |`);
  lines.push(`| No sensitive field leaked | ${clean}/${total} |`);
  lines.push(`| Median latency | ${median} ms |`);
  lines.push(`| Slowest case | ${slowest} ms |`);
  lines.push('');
  lines.push(`## Cases`);
  lines.push('');
  lines.push('| Case | Intent | Kind | Numbers | Rows | Slots | Leak | ms |');
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const score of scores) {
    lines.push(
      `| ${score.id} | ${tick(score.intentOk)} | ${tick(score.kindOk)} | ${tick(
        score.amountsOk && score.containsOk
      )} | ${tick(score.rowCountOk)} | ${tick(score.slotsOk)} | ${score.leaked.length ? 'LEAK' : 'clean'} | ${
        score.durationMs
      } |`
    );
  }

  const failures = scores.filter((s) => s.missing.length || s.error || s.leaked.length);
  if (failures.length) {
    lines.push('');
    lines.push('## Failures');
    lines.push('');
    for (const failure of failures) {
      lines.push(`### ${failure.id}`);
      lines.push('');
      lines.push(`- Question: ${failure.question}`);
      if (failure.error) lines.push(`- Error: ${failure.error}`);
      if (failure.missing.length) lines.push(`- Missing: ${failure.missing.join(', ')}`);
      if (failure.leaked.length) lines.push(`- Leaked: ${failure.leaked.join(', ')}`);
      lines.push(`- Got intent \`${failure.actualIntent}\`, kind \`${failure.actualKind}\``);
      lines.push('');
    }
  }

  lines.push('');
  lines.push('## Answers');
  lines.push('');
  for (const score of scores) {
    lines.push(`- **${score.id}**: ${score.sentence}`);
  }
  lines.push('');

  return lines.join('\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  clearBankCache();

  const chatModel =
    options.mode === 'model' || options.verbalize
      ? new ResilientChatModel({ service: options.service, model: options.model })
      : null;

  const modelName = chatModel?.name ?? 'none';
  console.log(`swiss cheese eval | mode=${options.mode} | model=${modelName} | as of ${asOf()}\n`);

  const scores: CaseScore[] = [];
  const goldThreads = new Map<string, Slots>();
  const actualThreads = new Map<string, Slots>();

  for (const testCase of GOLD_CASES) {
    const thread = testCase.thread;
    const previousGold = thread ? goldThreads.get(thread) ?? null : null;
    const previousActual = thread ? actualThreads.get(thread) ?? null : null;

    try {
      const { score, goldSlots, actualSlots } = await scoreCase(
        testCase,
        options,
        chatModel,
        previousGold,
        previousActual
      );
      scores.push(score);

      if (thread) {
        goldThreads.set(thread, goldSlots);
        actualThreads.set(thread, actualSlots);
      }

      const verdict =
        score.intentOk && score.kindOk && score.amountsOk && score.containsOk && score.rowCountOk && !score.leaked.length
          ? 'pass'
          : 'FAIL';
      console.log(`${verdict.padEnd(4)} ${score.id.padEnd(28)} ${score.durationMs}ms`);
      if (score.missing.length) console.log(`      missing: ${score.missing.join(', ')}`);
      if (score.leaked.length) console.log(`      LEAKED: ${score.leaked.join(', ')}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAIL ${testCase.id.padEnd(28)} ${message}`);
      scores.push({
        id: testCase.id,
        question: testCase.question,
        intentOk: false,
        kindOk: false,
        amountsOk: false,
        containsOk: false,
        rowCountOk: false,
        slotsOk: false,
        leaked: [],
        durationMs: 0,
        actualIntent: 'error',
        actualKind: 'error',
        missing: [],
        sentence: '',
        error: message
      });
    }
  }

  const scorecard = buildScorecard(scores, options, modelName);
  const outDir = join(here, 'out');
  await mkdir(outDir, { recursive: true });

  const slug = modelName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const file = options.out ?? join(outDir, `scorecard-${options.mode}-${slug}.md`);
  await writeFile(file, scorecard, 'utf8');

  const passed = scores.filter(
    (s) => s.intentOk && s.kindOk && s.amountsOk && s.containsOk && s.rowCountOk && !s.leaked.length && !s.error
  ).length;

  console.log(`\n${passed}/${scores.length} cases passed. Scorecard written to ${file}`);
  if (passed !== scores.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('eval failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closePool);
