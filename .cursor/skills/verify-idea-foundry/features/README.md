# Idea Foundry verification map

Drive the dashboard at `http://127.0.0.1:4440` after Launch in the verify skill. Read this index, then follow one feature file.

## Baseline preconditions

- Start the server with `--data .tmp/verify --seed` so the board has the five sample ideas.
- `control.sh doctor` reports `idea-foundry` on port 4440.
- Do not drive a server you did not start.

## Driving conventions

- Prefer accessible names over CSS selectors.
- Scope a button to the article named for that idea or spec.
- Run browser checks with `npx playwright test`.
- Run CLI checks with `control.sh cli`.

## Proof and skip reporting

- Capture the action and the resulting state.
- A saved idea is proven when the article shows the new state and `GET /api/state` agrees.
- Record a skipped entry point with the command you ran and the missing precondition.

## Features

- [Idea board](./idea-board.md) covers adding an idea, restate, and approve.
- [Stack lanes](./stack-lanes.md) covers decompose, dispatch, and draft ingest.
- [Gate chips](./gate-chips.md) covers pass and fail chips.
- [Lessons ledger](./lessons-ledger.md) covers a repeated finding.
- [Statechart](./statechart.md) covers the chart generated from the model.
