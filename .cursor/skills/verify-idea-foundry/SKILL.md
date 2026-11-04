---
name: verify-idea-foundry
description: Drive the Idea Foundry dashboard and CLI on a disposable data directory. Use when checking the board, a stack, gates, draft ingest, or the lessons ledger.
---

# Verify Idea Foundry

The primary surface is the dashboard. The CLI is the same store. There is no merge, deploy, or send control.

## Run

From the repo root, with Node 20+, a JDK 21 (`java` on `PATH`) for TLC, and `tesseract` plus `ffmpeg` for the PII scan:

```bash
RUN_ID=$(date +%s)
export FOUNDRY_DATA="/tmp/foundry-verify-$RUN_ID"
export FOUNDRY_PORT=4460
export PORT="$FOUNDRY_PORT"
export FOUNDRY_FRESH=1
export FOUNDRY_SEED=1
export FOUNDRY_OPEN_DRAFTS=0
npx tsx src/server.ts
```

Ready when this returns JSON with `"service":"idea-foundry"` and `"ideas"` greater than 0:

```bash
curl -sf "http://127.0.0.1:${FOUNDRY_PORT}/api/health"
```

The `port` field must equal `FOUNDRY_PORT`. The seed titles are `habit tracker export`, `weather widget`, `trivia scoring`, `palette mixer`, and `outline export`. Two runs need two data directories and two ports. Do not point `FOUNDRY_DATA` at a directory you did not create for this run.

Stop the server with the pid you started. Do not kill by process name.

## Doctor

```bash
curl -sf "http://127.0.0.1:${FOUNDRY_PORT}/api/health"
```

Continue only when `service` is `idea-foundry`, `ok` is true, and `port` is the port you set. A different service on that port is the wrong instance.

## Drive

Use Playwright against `http://127.0.0.1:${FOUNDRY_PORT}`. Stable handles are `data-testid` values.

- Add idea: `add-idea-title`, `add-idea-submit`, then `idea-<id>`.
- Restate, approve, decompose, gate, park: `action-restate`, `approve-note`, `action-approve`, `action-decompose`, `action-gate`, `action-park`.
- Spec lane: `spec-<id>`. Gate line: `gate-<id>-G1` (also G0, G2, and G3). Gates panel: `gates-panel`. A passing line contains the layer (`architecture`, `static`, `skills`, `human`) and `proof`.
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

## Observe

Capture the action and the state it wrote.

- Screenshot the board after the click, under `screenshots/proof/`.
- Read `GET /api/state` or `$FOUNDRY_DATA/state.json` and match the idea id.
- For a packet, read `packets/<spec-id>.json` and confirm three runner seats plus `verifier.graft: true`.
- For weekly, the CLI JSON is the observation: four numeric counts and the `since` date.
- `POST /api/merge` returns 403. A `--dry-run` leaves `state.json` unchanged.

## Isolate

Two boards can run at once. Give each its own `FOUNDRY_DATA` directory and its own `FOUNDRY_PORT` (for example 4440 and 4441). An idea added on one port must not appear on the other. Do not point both at the same data directory. `e2e/dashboard.spec.ts` covers that pair.

Stop only the pid you started. Do not kill by process name.

## Evidence

Write proof under `screenshots/proof/`. Keep the screenshot of the action and a second read of `state.json` or `GET /api/state`. The idea id in the UI and the idea id in the state response must match. Do not call a test-only setter. `POST /api/merge` must return 403. Dry-run is a CLI flag. Confirm it by checking that `state.json` is unchanged after `--dry-run`.

## Cleanup

Stop the server pid from this run. Remove only the `FOUNDRY_DATA` directory you created. Leave `screenshots/proof/` in place.

## Helpers

`scripts/verify-add-idea.ts` drives the add-idea feature and writes `screenshots/proof/add-idea.png` plus `screenshots/proof/add-idea.log`.

```bash
npx tsx scripts/verify-add-idea.ts
```
