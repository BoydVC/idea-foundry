# Idea Foundry

## Repo status

Pass 5 is on `foundry/pass5`, branched from `foundry/hardening` (which already contains `foundry/winner` and the hardening fixes, including `screenshots/demo.gif` at `2f2eb21`). The pull request into `foundry/winner` is a draft. Do not merge it. Do not deploy it. Foundry never merges, deploys, or sends.

The board is a local dashboard and a CLI over one JSON store. Fixtures are synthetic. Titles are generic product names. Personal data and real names are out of scope.

## Pipeline

raw idea → restatement (goal, problem, smallest change, done-when) → approval → architect sketch → arena packet (≥2 runner seats and a verifier) → static gates → draft pull request.

Gates follow the inverse trust pyramid:

| Layer | Check |
| --- | --- |
| G0 architecture | The spec sketch typechecks. |
| G1 static | Runnable acceptance, touch map, TLC, blast radius. |
| G2 skills | Done-when, concrete verbs, synthetic-data clause. |
| G3 human | Draft proof only. Merge is forbidden. |

A spec that touches `src/store.ts` or `src/domain.ts` needs proof level 4: a runnable acceptance command. A finding that repeats becomes a lesson, and the gate stays red until that lesson has a check in `LESSON_CHECKS`. `foundry correct` only writes a proposal.

## Checks

`npm test`, `npm run typecheck`, `npm run statechart:check`, `npm run tlc`, `npm run tlc:mutant`, `npm run pii`, and `npm run test:e2e`.

TLC needs a JDK. The PII scan needs tesseract and ffmpeg. See the README prerequisites. `npm run tlc:mutant` prints a shortest path for each violated invariant. `scripts/record-demo.ts` rebuilds `screenshots/demo.gif` from its video. The committed gif is the one regenerated on `foundry/hardening`.
