# Idea Foundry verification map

This directory is the source for driving Idea Foundry. Read it before a run, then follow one feature file.

## Baseline preconditions

- Launch the dashboard with a fresh `FOUNDRY_DATA` directory so the five seed ideas exist.
- Doctor must show at least five ideas before a browser drive.
- Do not share a data directory with another process.
- Seed titles are habit tracker export, weather widget, trivia scoring, markdown note export, and kitchen timer.

## Driving conventions

- Start from the seeded board unless the feature says otherwise.
- Use accessible names. Idea cards are buttons named with the title.
- Keep quoted titles and flags unchanged.
- Browser drives go through Playwright or the steps in the feature file.
- CLI drives go through `node --experimental-strip-types src/cli.ts`.

## Proof and skip reporting

- Capture the action and the resulting state.
- A screenshot must show the idea title and the state word.
- CLI proof includes stdout JSON and a later `show` of the same id.
- If a precondition is missing, report the failure. Do not skip the step and call it passed.

## Features

- [Add an idea](./add-idea.md) covers the form, the raw card, and restate.
- [Land a stack](./land-stack.md) covers approve, decompose, gates, dispatch, and draft ingest.
- [Refuse merge](./refuse-merge.md) covers the merge, deploy, and send refusals.
