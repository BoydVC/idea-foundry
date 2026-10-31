# Idea Foundry

Idea Foundry turns a raw idea into an ordered stack of small specs, checks those specs, and writes an arena packet for a draft pull request. The dashboard listens on port 4440. Nothing in this repo merges or deploys.

## Run

```bash
npm install
npm test
npm run typecheck
npm run tlc
npm run dashboard
```

Open `http://127.0.0.1:4440`.

The `foundry` command prints JSON. `--dry-run` computes the next record and does not write.

```bash
npx foundry idea "weather widget"
npx foundry restate i-0001
npx foundry approve i-0001 --note "Use the fixture only"
npx foundry decompose i-0001
npx foundry gate i-0001
npx foundry dispatch s-0001-1
npx foundry ingest s-0001-1 --report report.md --pr https://github.com/BoydVC/idea-foundry/pull/1
```

`foundry record` is the same command as `foundry ingest`. `foundry next` prints the packet Draft Day would take next.

A report file needs two lines.

```
draft: true
outcome: verified
```

`outcome` may be `rejected`. A verified ingest with `draft: false` is refused, and the spec stays `dispatched`.

## Model

`model/foundry.tla` is the lifecycle. `npm run tlc` runs TLC on `model/foundry.cfg` and then on `model/foundry_skip_gate.cfg`. The honest config must pass. The skip-gate config must violate `DispatchRequiresGate`.

`statechart.mmd` is generated from `TransitionTable` in the model. `npm run gen:statechart` rewrites it. `src/transition.ts` is the same table, and `test/transition.test.ts` fails if the two disagree.

## Data

Runtime state goes in `data/state.json` plus `ideas.jsonl`, `events.jsonl`, and `lessons.jsonl`. A write compares the snapshot version and returns 409 when the version is stale. Only `src/store.ts` writes those files.

Seed titles are generic: habit tracker export, weather widget, trivia scoring, markdown note export, and kitchen timer. The board labels the operator `Demo User`.
