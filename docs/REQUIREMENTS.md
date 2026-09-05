# meow

Conversational finance assistant for a corporate treasury team. Answers are grounded in `bank` / `account` / `transaction` only. The assistant is a cat named **meow**: short, slightly feline, never cute at the cost of a number.

Gold conversations: [EXAMPLES.md](EXAMPLES.md). Schema (do not change): [SCHEMA.md](SCHEMA.md).

## Goal

A finance lead can ask in plain language and get a trustworthy insight in seconds: cash by bank, period spend/receipts, counterparty concentration, period compare, reference lookup, plus a clear refuse when the schema cannot answer.

## Non-goals

- Do not change or extend the schema (no vendor, recon, COA, budget tables).
- No live bank/ERP, no auth, no multi-tenant, no forecasting.
- No free-form text-to-SQL. No LLM arithmetic.
- Official unreconciled / budget vs actual / P&L / historical cash: refuse.

## Locked product rules

- As of **5 Sep 2026**. Currency **INR**. **Indian FY** (Apr-Mar).
- **Cash** = sum of `available_balance`. **Period movement** = credits minus debits. Never mix.
- One group-treasury view. `program_id` is a raw code. `entity_id` is not a named subsidiary.
- Vendors = alias match on `description`. Ambiguous name → clarify, do not pick a winner.
- Bare "ref no" → `transaction_reference_id`. Search UTR only if the user says UTR.
- Mask account numbers (`HDFC 5020****9069`). Never print UTR.
- Empty window → say empty. Missing ref is a labeled proxy, never "unreconciled."
- Bank names come from the `bank` table only.

## Answer contract

Every reply must have:

1. One-sentence answer (meow voice, numbers exact).
2. Breakdown table the user can check.
3. Trail: template name, filters / date bounds, row count.
4. If refused: say why, then the nearest grounded alternative.

Persona: cat, not clown. "meow" once is enough. Never invent a figure to stay in character.

## Architecture (do not drift)

```
user → NLU slots (small LLM) → resolve (dates, bank, alias) → policy (clarify/refuse)
     → SQL template → JSON payload → verbalizer (same LLM, payload only) → UI
```

- Closed intent catalog. Parameterized SQL only.
- Verbalizer prompt contains computed JSON only. No raw table dump of 20M rows.
- Multi-turn = last intent + slots. "Month before" shifts dates.
- Scale target: 20M rows. Indexes + capped UI table.

**Intents:** `cash_position` · `period_spend` · `inflow_outflow` · `counterparty_breakdown` · `compare_period` · `lookup_reference` · `missing_reference` · `clarify_counterparty` · `refuse`

## Evals (do this first, keep it honest)

Evals are the product proof and the way we compare models. Do not demo a model that has no score on the frozen set.

- **Gold set:** the 12 conversations in [EXAMPLES.md](EXAMPLES.md). Figures must match those gold totals on the sample seed.
- **Baseline model:** `qwen3.8:27b`. Freeze its scores before swapping models.
- **Hackathon cap is 20B.** 27B is over that cap. Baseline is for engineering; the judged entry must include a ≤20B run on the same harness.
- Same questions, same slots, same SQL templates. Only the NLU + verbalizer model changes.
- Score separately: intent, slots, number exact-match, correct refuse, no leaked sensitive field, latency.
- A wrong number is a fail even if the prose sounds right.
- Unit tests (`test/`, Mocha): template SQL and resolvers, not live LLM. E2E model runs are `*.e2e.test.ts`.

## Build order

- [ ] Seed the 3 tables from SCHEMA.md. Gold SQL matches EXAMPLES.md totals.
- [ ] Eval harness + `qwen3.8:27b` baseline on the 12 cases (intent / slots / numbers / refuse).
- [ ] SQL templates for each intent. Resolvers: FY dates, bank list, aliases, mask, ref vs UTR.
- [ ] Policy: clarify / refuse / empty. Verbalizer consumes JSON only. meow persona in the verbalizer prompt.
- [ ] Chat UI: answer + table + trail + CSV. Multi-turn slot memory.
- [ ] 20M-row smoke. Then other models vs the frozen baseline.
- [ ] README, architecture note, model card (baseline vs judged model), demo on EXAMPLES 1, 3, 5, 10.

## Agent guardrails

If a change would add a column, let the LLM write SQL, compute a total in the model, skip an eval, or break an EXAMPLES.md gold number: stop.
