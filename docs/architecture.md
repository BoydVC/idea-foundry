# Architecture

Idea Foundry is the front office for a portfolio of ideas. A person adds an idea, restates it, approves it, and gets an ordered stack of specs. Each spec is gated, dispatched as an arena packet, and ingested only from a draft pull request. The program never merges.

## Shape

Two designs were possible.

One design keeps the legal steps in `model/foundry.tla` and makes TypeScript follow that table. The other design keeps the table in TypeScript and generates the model from it. The model has to be first, because TLC is the check that a skipped gate and a stale write are impossible. The TypeScript `transition` function is an exhaustive switch over the same rows. A test reads `TransitionTable` and fails when a row and the switch disagree.

The stack and the compare-and-swap counter live in the same model as the lifecycle. A spec can become `verified` only when its pull request is a draft and every lower spec is already `verified`. A successful write consumes the current version exactly once. The skip-gate config adds a dispatch from `specced` and TLC reports `DispatchRequiresGate`.

## Modules

`src/transition.ts` is pure. `src/service.ts` applies that function to ideas and specs. `src/store.ts` is the only module that writes `state.json` or the JSONL logs. `src/planner.ts` is the deterministic fixture planner. `src/gates.ts` checks G1, G2, and G3. `src/server.ts` and `src/cli.ts` are the edges. They parse input and call the service.

Shared state is one snapshot. Writers take a lock, re-read the version, and rename a temp file into place. Two writers do not keep separate copies of the board.

## What the model leaves out

The model uses two specs and a version bound of 12. It does not model the dashboard HTTP routes. Those routes are covered by the server test and the Playwright walk.
