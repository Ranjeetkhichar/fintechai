# Swiss Cheese model card

## What the model is responsible for

Two calls per question, and nothing else.

| Call | Input | Output | Can it affect a number? |
|---|---|---|---|
| `fillSlots` | The question, plus a one-line recap of the previous turn | JSON slots: intent, the date *wording*, counterparty name, bank name, reference | Indirectly. A wrong intent or a wrong date phrase produces the wrong query |
| `verbalize` | The computed payload, amounts already formatted as strings | One sentence | No. Every figure is copied from the payload |

Everything between the two calls is deterministic: date resolution against a fixed clock, bank code lookup, alias matching, policy, SQL, masking, formatting.

This is why swapping models is cheap. A weaker model degrades intent accuracy and phrasing. It cannot degrade a total.

## How models are compared

Same 12 frozen conversations from [EXAMPLES.md](EXAMPLES.md), same fixed clock, same database.

```bash
npm run eval                                             # gold slots, no model
npm run eval -- --slots=model --model=qwen3.8:27b        # baseline NLU
npm run eval -- --slots=model --model=<candidate>        # judged entry
npm run eval -- --slots=model --model=<candidate> --verbalize   # add phrasing
```

Scored dimensions:

| Dimension | Meaning |
|---|---|
| Intent correct | Right template chosen |
| Outcome kind correct | answer / clarify / refuse / empty |
| Numbers exact | Every expected figure appears, character for character |
| Row count correct | The trail agrees with the gold row count |
| Slots match gold | Resolved window, bank, counterparty and reference all match |
| No sensitive field leaked | No raw account number or UTR fragment anywhere in the payload or sentence |
| Latency | Median and worst case per question |

The gold-slot row is the control. If it is not 12/12, no model number means anything, because the engine itself is wrong.

## Results

Fill in from `eval/out/`. Each run writes its own scorecard.

| Run | Params | Intent | Kind | Numbers | Slots | Leaks | Median latency |
|---|---|---|---|---|---|---|---|
| Gold slots (no model) | - | | | | | | |
| qwen3.8:27b (baseline) | 27B | | | | | | |
| Judged entry | ≤20B | | | | | | |

> The hackathon cap is 20B. The 27B baseline is over it, so it is recorded as a reference point only and the judged entry needs its own row.

## Candidate models at or under 20B

Any model reachable through a `resilient-llm` provider works; `AI_MODEL` is the only thing that changes. Worth trying on Ollama:

- `qwen3:14b`
- `qwen3:8b`
- `gemma3:12b`
- `mistral-small` (24B, over the cap, useful as a second reference)

## What to look for when a smaller model loses points

| Failure | Likely cause | Where to fix |
|---|---|---|
| Wrong intent on comparison follow-ups | The previous-turn recap is too terse | `nlu.ts`, `contextLine` |
| Date phrase rewritten instead of copied | The model is trying to resolve dates itself | Tighten the "copy date wording" rule in the slot prompt |
| Refusal topics missed | Model is optimistic about the schema | Already covered by the deterministic pre-check in `refusals.ts`; extend the patterns |
| Counterparty over-specified | Model expands "Selection" to a full name | Alias resolution will still flag ambiguity; check `aliases.ts` |
| Sentence contains a number not in the payload | Verbalizer hallucination | Hard failure. Lower temperature, or fall back to `fallbackSentence` |

The last row is the only failure class that would let a wrong number reach a user, and it is the one the leak and number checks in the harness exist to catch.
