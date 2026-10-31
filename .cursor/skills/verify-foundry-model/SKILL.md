---
name: verify-foundry-model
description: Re-check the Idea Foundry TLA+ model when a change touches transition, the CAS store, stack order, or draft ingest. Use /statechart to read a failing TLC trace.
---

# Verify the foundry model

TLC checks four invariants on a small model of one idea and two specs. The model is `model/foundry.tla`. The code it tracks is `transition` in `src/domain.ts`, the version bump in `src/store.ts`, and draft ingest plus stack order in `src/service.ts`.

A pass means those invariants hold for every reachable state in the bounds below. It does not mean the dashboard, the gate text, or a live GitHub pull request was checked.

## When a change needs another look

Run this skill if the diff touches any of these files:

- `src/domain.ts`
- `src/store.ts`
- `src/service.ts`
- `model/foundry.tla`
- `model/foundry.cfg`

The model was last confirmed against commit `SYNC_COMMIT`. If those files changed after that commit, the model may be stale. Move `SYNC_COMMIT` forward only after TLC passes and you have read the actions against the new code.

## Run

From the repo root:

```sh
npm run tlc
```

The command downloads `tla2tools.jar` into `.tools/` on first use, checks `foundry.tla`, then checks a generated model that skips the gate. The good run must print `No error has been found`. The skip-gate run must exit non-zero and print `Invariant`. Java 21 and Node 22 are enough. No network is required after the jar is cached.

Read a failing trace with `/statechart`. Do not copy that skill's commands into this file. They change between machines.

## What the invariants say

- `NoMergeState` means the idea and the specs never enter a merged state.
- `VerifiedImpliesDraftPR` means a verified spec recorded a draft pull request.
- `StackLandsBottomUp` means spec 2 is not verified while spec 1 is not.
- `CASNoLostUpdate` means two writers that read the same version produce one successful update.

## Bounds and gaps

The model uses one idea, two specs, and `ver <= 16`. Two CAS writers both read version 0, then one write wins. The model does not include the G1 or G2 text lints, the HTTP server, or a real pull-request lookup. Draft is a boolean the ingest action sets. A self-loop that only bumps the version is not a separate TLC action.

## A failure you can see

`npm run tlc` builds `.tmp/tlc/foundry_skip_gate.tla` by adding `SkipGate`, which marks spec 2 verified before the gate and without a draft. TLC must report an invariant violation. If that run passes, the check is broken. Do not weaken the invariant.

Keep this file aligned with `/maintain-formal-verification-skill` after a model change.
