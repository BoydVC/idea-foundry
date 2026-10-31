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

`statechart:check` fails when the legal `transition` edges and the TLA actions differ, or when `model/statechart.mmd` is stale. `npm run tlc` must exit 0. `npm run tlc:mutant` must exit 0 only when `foundry_skip_gate.cfg` violates `DispatchRequiresGate`, `foundry_merge.cfg` violates `NoMergeState`, and `foundry_lost.cfg` violates `CASNoLostUpdate`. A mutant that typechecks and finds no violation is a failed check.

Read a failing TLC log with `/statechart`. Do not copy that skill's commands into this file.

## What is proved

In the model, with one idea and two specs, and with the compare-and-swap counter bounded by 3:

- `NoMergeState`: the phase is never `merged`.
- `VerifiedImpliesDraftPR`: a verified spec has the draft flag set by the gate.
- `StackLandsBottomUp`: spec 2 is verified only after spec 1 is verified.
- `VerifiedIdeaNeedsSpecs`: a verified idea still has both specs verified. Un-verify reopens the idea in the same step.
- `CASNoLostUpdate`: the stored counter equals the number of successful commits.
- Either spec can `gate_fail`, and the idea returns to `specced` when a spec is no longer gated, dispatched, or verified.

`SkipGate` deletes the gate precondition on dispatch. TLC's counterexample reaches `dispatched` from `specced` and violates `DispatchRequiresGate`. `AllowMerge` reaches `merged`. `LoseUpdate` commits twice from the same read.

## What is not proved

The model does not run the dashboard, the planner text, or the file lock. The lock and the 409 path are the fast-check test in `test/store.test.ts`. Two specs are the bound. A stack of six is the same rule, not a larger model.

## Coverage

| Check | Code |
| --- | --- |
| `transition` edges | `src/domain.ts` `transition`, `edgesOfTransition` |
| Draft and stack order | `src/commands.ts` `ingest` |
| Chart | `model/foundry.tla`, `model/statechart.mmd`, `src/statechart.ts` |

Last confirmed against commit `88bdbac1d0f9302a9609d62ff44c44891a5cf73c`. Move that commit forward only after the three commands above match this file at the new commit.

Keep the product code as it is when a check fails. Report the counterexample in the words of the actions. Suggest `/maintain-formal-verification-skill` when the model and `transition` drift.
