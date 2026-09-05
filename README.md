# Swiss Cheese

Conversational finance assistant for a corporate treasury team. The assistant is named **Swiss Cheese**.

Swiss Cheese answers questions about bank balances and transactions in plain English. The important part is what it does *not* do: the model never sees the database, never writes SQL, and never produces a number. It fills slots, and it phrases a result that Postgres already computed.

```
question -> slots (model) -> resolvers -> policy -> SQL template -> payload -> sentence (model)
```

Every answer carries the table it came from and a trail of the filters used, so a finance user can check the figure rather than trust it.

## Setup

Requires Node 20.19 or newer and a Postgres database (Neon works out of the box).

```bash
npm install
cp .env.example .env      # fill in DB_CONNECTION_STRING
npm run db:setup          # schema, sample rows, indexes, sanity report
npm run eval              # gold-slot scorecard, no model needed
npm run dev               # client on :5173, server on :3000
```

`.env` is gitignored. Never commit a connection string.

### Environment

| Variable | Purpose |
|---|---|
| `DB_CONNECTION_STRING` | Postgres connection. Required. |
| `CHEESE_AS_OF` | Fixed clock, default `2026-09-05`. Every relative date resolves against it. |
| `AI_SERVICE` / `AI_MODEL` | Model used for slot filling and phrasing. Defaults to Ollama and `qwen3.8:27b`. |
| `LLM_BASE_URL` | OpenAI-compatible gateway for every provider. Defaults to Coral Bricks (`https://inference.coralbricks.ai/v1`). |
| `CORAL_API_KEY` | API key for that gateway. Provider-specific keys (`OPENAI_API_KEY`, and so on) still work. |

The fixed clock is not a convenience. The gold answers in [docs/EXAMPLES.md](docs/EXAMPLES.md) assume "as of 5 Sep 2026", so a real system clock would make "last month" drift and every expected number would rot.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite client plus the Express server under `tsx` |
| `npm run db:ping` | Connection diagnostic. Run this first if the database will not respond |
| `npm run db:setup` | Applies `db/schema.sql`, `db/seed.sql`, `db/indexes.sql`, then prints a sanity report |
| `npm run db:bulk` | Generates synthetic volume for plan testing |
| `npm run db:explain` | `EXPLAIN ANALYZE` on the alias query, reports whether the trigram index was used |
| `npm run eval` | Gold-slot scorecard. No model required |
| `npm run eval -- --slots=model --model=<name>` | Scores a model's NLU on the same questions |
| `npm test` | Unit tests, no live services |
| `npm run test:e2e` | Live-model tests |
| `npm run typecheck` | `tsc --noEmit` |

## Evaluation

The harness runs in two modes, and keeping them apart is the point:

- `--slots=gold` feeds hand-written slots, so a failure means the SQL, the masking or the policy is wrong.
- `--slots=model` runs the real NLU, so a failure means intent or slot extraction is wrong.

A number regression and a language regression therefore never look alike. Scorecards land in `eval/out/`.

## Layout

```
db/          schema, seed, indexes, bulk generator, plan check
server/
  db/pool.ts        the only path to Postgres
  pipeline/
    resolve/        dates, banks, counterparty aliases, references
    sql/            one template per intent, all parameterized
    mask.ts         account masking, UTR suppression, INR formatting
    payload.ts      the only place an AnswerPayload is built
    policy.ts       answer / clarify / refuse / empty
    nlu.ts          slot prompt
    verbalize.ts    phrasing prompt and the deterministic fallback
  routes/ask.ts     POST /api/cheese/ask
client/      React playground shell with the answer card
eval/        gold cases and the scorecard runner
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - the pipeline in detail
- [Requirements](docs/REQUIREMENTS.md) - product rules and the answer contract
- [Examples](docs/EXAMPLES.md) - the 12 frozen gold conversations
- [Schema](docs/SCHEMA.md) - the three fixed tables
- [Demo](docs/DEMO.md) - the walkthrough
- [Model card](docs/MODEL-CARD.md) - baseline versus the judged model
