# Idea Foundry

Idea Foundry turns a raw idea into a short stack of specs, runs the gates, and writes an arena packet for a draft pull request.

## Start the dashboard

Install dependencies, then start the board with the sample ideas.

```sh
npm install
npm run statechart
node src/cli.ts serve --port 4440 --seed
```

Open http://127.0.0.1:4440

You should see the idea board, stack lanes, gate chips, the lessons ledger, and the statechart. The sample ideas are generic, such as habit tracker export and weather widget. The layout fits a 390 pixel wide window.

## Walk an idea

Run these from a second terminal. Each command prints JSON. Add `--dry-run` to preview a write. A stale `--version` returns status 409 and tells you to re-read state.

```sh
node src/cli.ts idea "habit tracker export"
node src/cli.ts restate i-0001
node src/cli.ts approve i-0001 --note "Ship the sample slice."
node src/cli.ts decompose i-0001
node src/cli.ts gate i-0001
node src/cli.ts dispatch s-0001-1
node src/cli.ts ingest s-0001-1 --report report.md --pr https://github.com/BoydVC/idea-foundry/pull/1
```

`report.md` needs a header. `draft: false` is refused, and the spec stays dispatched.

```markdown
---
draft: true
verdict: verified
---
Sample report. Synthetic data only. No personal data.
```

`dispatch` writes `packets/<spec-id>.json` and an `intake.jsonl` line with `idea`, `source`, `target`, and `n`. That line is the Draft Day inbox shape.

## Checks

```sh
npm test
npx tsc --noEmit
npm run tlc
npm run check:chart
npx playwright test
node scripts/pii-scan.mjs
```

`npm run tlc` passes `model/foundry.tla` and must fail the skip-gate mutation. `POST /api/merge`, `POST /api/deploy`, and `POST /api/send` return 403. Nothing in this repo merges a pull request.
