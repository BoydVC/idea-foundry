---
name: verify-idea-foundry
description: Drive the Idea Foundry dashboard and CLI on a disposable data directory. Use when checking the board, a stack, gates, draft ingest, or the lessons ledger.
---

# Verify Idea Foundry

The primary surface is the dashboard at `http://127.0.0.1:4440`. The CLI is the same store. There is no merge, deploy, or send control.

## Launch

From the repo root, with Node 20+ and dependencies installed:

```bash
RUN_ID=$(date +%s)
export FOUNDRY_DATA="/tmp/foundry-verify-$RUN_ID"
export PORT=4460
export FOUNDRY_FRESH=1
export FOUNDRY_SEED=1
npx tsx src/server.ts
```

Ready when this returns JSON with `"service":"idea-foundry"` and `"ideas"` greater than 0:

```bash
curl -sf "http://127.0.0.1:${PORT}/api/health"
```

The seed titles are `habit tracker export`, `weather widget`, `trivia scoring`, `palette mixer`, and `outline export`. Two runs need two data directories and two ports. Do not point `FOUNDRY_DATA` at a directory you did not create for this run.

Stop the server with the pid you started. Do not kill by process name.

## Doctor

```bash
curl -sf "http://127.0.0.1:${PORT}/api/health"
```

Continue only when `service` is `idea-foundry`, `ok` is true, and `port` is the port you set. A different service on that port is the wrong instance.

## Drive

Use Playwright against `http://127.0.0.1:${PORT}`. Stable handles are `data-testid` values.

- Add idea: `add-idea-title`, `add-idea-submit`, then `idea-<id>`.
- Restate, approve, decompose, gate, park: `action-restate`, `approve-note`, `action-approve`, `action-decompose`, `action-gate`, `action-park`.
- Spec lane: `spec-<id>`. Gate line: `gate-<id>-G1` (also G2 and G3).
- Dispatch and ingest: `dispatch-<id>`, `ingest-pr-<id>`, `ingest-draft-<id>`, `ingest-<id>`.
- Board, chart, lessons: `board`, `statechart`, `lessons`.

One scripted path for the add-idea feature:

```bash
npx tsx scripts/verify-add-idea.ts
```

That command starts its own server, drives the form, writes proof, and stops the server.

CLI path for the same store, after the server is up:

```bash
npx tsx src/cli.ts --data "$FOUNDRY_DATA" idea "unit converter card"
```

The JSON `data.id` is the new idea. `GET /api/state` then lists that id.

## Evidence

Write proof under `screenshots/proof/`. Keep the screenshot of the action and a second read of `state.json` or `GET /api/state`. The idea id in the UI and the idea id in the state response must match. Do not call a test-only setter. `POST /api/merge` must return 403. Dry-run is a CLI flag. Confirm it by checking that `state.json` is unchanged after `--dry-run`.

## Cleanup

Stop the server pid from this run. Remove only the `FOUNDRY_DATA` directory you created. Leave `screenshots/proof/` in place.

## Helpers

`scripts/verify-add-idea.ts` drives the add-idea feature and writes `screenshots/proof/add-idea.png` plus `screenshots/proof/add-idea.log`.

```bash
npx tsx scripts/verify-add-idea.ts
```
