---
name: verify-foundry-model
description: Re-check the Idea Foundry phase machine in model/foundry.tla when transition() or the model changes. Use after editing src/domain.ts or model/foundry.tla.
---

# Verify the foundry model

TLA+ is the check because the bug is a bad order of steps, and tests only hit the orders someone wrote down. TLC explores the model. The TypeScript machine is `transition` in `src/domain.ts`. The model is `model/foundry.tla`.

## When a change touches this

Re-run the checks when you edit `transition`, `edgesOfTransition`, `model/foundry.tla`, `model/foundry.cfg`, `model/foundry_mutant.tla`, or `src/statechart.ts`.

## Run

From the repo root, with Java 21:

```bash
npm run statechart:check
npm run tlc
npm run tlc:mutant
```

`statechart:check` fails when the legal `transition` edges and the TLA actions differ, or when `model/statechart.mmd` is stale. `npm run tlc` must exit 0. `npm run tlc:mutant` must exit 0 only because TLC reports that `VerifiedImpliesDraftPR` is violated. A mutant that typechecks and finds no violation is a failed check.

Read a failing TLC log with `/statechart`. Do not copy that skill's commands into this file.

## What is proved

In the model, with one idea and two specs, and with the compare-and-swap counter bounded by 3:

- `NoMergeState`: the phase is never `merged`.
- `VerifiedImpliesDraftPR`: a verified spec has the draft flag set by the gate.
- `StackLandsBottomUp`: spec 2 is verified only after spec 1 is verified.
- `CASNoLostUpdate`: the stored counter equals the number of successful commits.

The mutant deletes the gate precondition and the draft check. TLC's counterexample is restate, approve, decompose, dispatch from `specced`, verify while the draft flag is still false.

## What is not proved

The model does not run the dashboard, the planner text, or the file lock. The lock and the 409 path are the fast-check test in `test/store.test.ts`. Two specs are the bound. A stack of six is the same rule, not a larger model.

## Coverage

| Check | Code |
| --- | --- |
| `transition` edges | `src/domain.ts` `transition`, `edgesOfTransition` |
| Draft and stack order | `src/commands.ts` `ingest` |
| Chart | `model/foundry.tla`, `model/statechart.mmd`, `src/statechart.ts` |

Last confirmed against commit `PENDING`. Move that commit forward only after the three commands above match this file at the new commit.

Keep the product code as it is when a check fails. Report the counterexample in the words of the actions. Suggest `/maintain-formal-verification-skill` when the model and `transition` drift.
