# Idea Foundry

Idea Foundry turns one raw idea into an ordered stack of small specs, runs the static gates, and writes a draft arena packet. It does not merge, deploy, or send anything.

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
npm run foundry -- ingest s-0001-1 --report report.md --pr https://example.com/demo/pull/1
```

Every command prints one JSON object. Add `--dry-run` to preview a write. A stale version returns status 409. The `next` field says what to run after an error.

`ingest` accepts only a draft pull request. A report with `draft: false` leaves the spec dispatched.

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

`npm run tlc:mutant` passes only when the mutated model violates `VerifiedImpliesDraftPR`.
