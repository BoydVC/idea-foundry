# Idea Foundry

Idea Foundry turns one raw idea into an ordered stack of small specs, runs the static gates, and writes a draft arena packet. It does not merge, deploy, or send anything.

## Run the pipeline

About two minutes from a raw idea to a Draft Day pick. This does not merge anything.

```bash
npm ci
npm run pipeline
```

The script restates, approves, decomposes, and gates `habit tracker export`, dispatches the bottom spec, and runs Draft Day's `dd intake --from-inbox` on that inbox line. Draft Day is cloned read-only at `fa266c249405c25db0b900ce0cc5d3a0fd744ce7`. The printed JSON includes the pick id and `status: intake`.

Peer review is optional. `foundry gate` asks `http://127.0.0.1:4333/review` and continues when that port is closed. Set `FOUNDRY_REVIEW_URL` to point the adapter somewhere else.

## Run the board

```bash
npm install
FOUNDRY_SEED=1 npm run dashboard
```

Open http://127.0.0.1:4440. The seed board uses generic titles such as "habit tracker export" and "weather widget".

## Walk one idea

```bash
npm run foundry -- idea "habit tracker export"
npm run foundry -- restate i-0001
npm run foundry -- approve i-0001 --note "Ship the smallest slice"
npm run foundry -- decompose i-0001
npm run foundry -- gate i-0001
npm run foundry -- dispatch s-0001-1
npm run foundry -- ingest s-0001-1 --report report.md --pr https://github.com/example-org/demo-board/pull/1
```

Every command prints one JSON object. Add `--dry-run` to preview a write. A stale version returns status 409. The `next` field says what to run after an error.

`ingest` accepts only `https://github.com/<owner>/<repo>/pull/<number>`. It asks the GitHub API whether that pull request is a draft, including when the spec is already verified. When the API answers, that answer wins. When the API is unreachable, ingest uses the report line and returns a warning. Pass `--version` or `--record-version` to send the record version you read. A mismatch returns 409. `foundry gate` runs TLC on `model/foundry.tla` and fails the gate when TLC fails. `foundry dispatch` appends `{idea, source, target, n}` to `intake.jsonl` only after the compare-and-swap succeeds.

## Checks

```bash
npm test
npm run typecheck
npm run statechart:check
npm run tlc
npm run tlc:mutant
npm run pii
npm run test:e2e
```

`npm run tlc:mutant` passes only when `foundry_skip_gate.cfg` violates `DispatchRequiresGate`, `foundry_merge.cfg` violates `NoMergeState`, and `foundry_lost.cfg` violates `CASNoLostUpdate`. All three configs use `model/foundry.tla`.
