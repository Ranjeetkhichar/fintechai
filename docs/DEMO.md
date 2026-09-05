# Swiss Cheese demo

Six minutes. Four questions. The through-line is that a language model is doing the language and nothing else.

Before starting: `npm run db:setup`, then `npm run dev`. Confirm `CHEESE_AS_OF=2026-09-05` so the dates below land where they should.

## 0. Open with the claim, not the character (30s)

> "Every number on this screen came out of Postgres. The model wrote the sentence around it and filled in the filters. It never saw a row and it never did arithmetic."

Open the settings drawer briefly so the audience sees the model is swappable, then close it.

## 1. Cash position - it answers (60s)

**Ask:** *What is our cash position across banks right now?*

Expect `INR -8,12,29,672.84` across 10 accounts, split by bank.

Expand **How this was produced**. Point at `template: cash_position` and the row count.

> "That is the trail. Every answer has one. A treasury team does not need to trust the assistant, they need to be able to check it."

Note the account column: `HDFC 5020****9069`. Masking happens in the payload builder, so no code path can print a full account number.

## 2. Empty window - it declines to fill the silence (60s)

**Ask:** *How much did we spend last month?*

August 2026 has no rows. Swiss Cheese says the window is empty and offers June 2026 with its real total.

> "This is the failure mode that matters. An ungrounded assistant produces a confident number here. Swiss Cheese reports an empty window, and the alternative it offers is itself a query result, not a guess."

## 3. Follow-up and comparison - the multi-turn bit (75s)

**Ask:** *How much did we spend in June?* → `INR 1,69,299.00` over 4 debits.

**Then ask:** *How does that compare to the month before?*

The second question names no window. The server reuses the June window from the previous turn and shifts it back one month: May 2026, `INR 71,156.00`, a difference of `INR 98,143.00`.

> "The model was told 'the month before'. It did not work out what that meant. It reported the phrase, and code resolved it against a fixed clock and the previous turn."

## 4. Ambiguity - it asks instead of picking (75s)

**Ask:** *How much did we pay Selection last quarter?*

Four counterparties in Q1 FY26-27 match "Selection". Swiss Cheese returns all four with their totals plus a combined `INR 2,19,299.00`, and no single answer.

> "There is no vendor table. Counterparties live inside statement text. Guessing which Selection was meant would produce a number that is precise and wrong, so it asks."

Note "last quarter" resolved to Apr-Jun, not Jan-Mar. Indian fiscal year, handled in code.

## 5. Refusal - the schema gap, stated plainly (60s)

**Ask:** *Which transactions are still unreconciled?*

Swiss Cheese refuses: no reconciliation status, no invoice table, no ledger to match against. Then it offers the labelled proxy - the one transaction with no reference number - and says explicitly that a missing reference is not the same as unreconciled.

> "A deterministic pre-check catches this before the model runs. Whatever intent the model guesses, this question cannot become a total."

## 6. Close on the evals (60s)

Run in a second terminal:

```bash
npm run eval
```

Show the scorecard.

> "Twelve frozen conversations. Gold-slot mode runs no model at all, so a failure means the SQL is wrong. Model-slot mode runs the real NLU, so a failure means the language layer is wrong. Two different bugs that never look alike, which is why we can swap a 27B model for a smaller one and know within a minute whether anything broke."

Finish on [docs/MODEL-CARD.md](MODEL-CARD.md).

## If something goes wrong

| Symptom | Cause |
|---|---|
| Every question errors | `DB_CONNECTION_STRING` missing, or `npm run db:setup` not run |
| Dates land in the wrong month | `CHEESE_AS_OF` unset or overridden |
| Sentence is odd but the table is right | Verbalizer fell back. The grounded half is unaffected, which is the design |
| Model call times out | Ollama not running. The answer card still renders from the payload |
