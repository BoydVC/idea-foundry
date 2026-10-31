---
name: verify-idea-foundry
description: Drive the Idea Foundry dashboard and CLI on synthetic seed data. Use to prove the board, stack landing, and the merge refusal on port 4440.
---

# Verify Idea Foundry

The primary surface is the dashboard at `http://127.0.0.1:4440`. The `foundry` CLI is the second surface. Both read the same data directory. Drive one instance per run. A second process on the same directory races the compare-and-swap lock.

## Launch

From the repo root, with dependencies installed (`npm install`) and Java plus `tla2tools.jar` available for gate checks (`TLA2TOOLS` or `/tmp/tlc/tla2tools.jar`):

```bash
rm -rf .data-verify
FOUNDRY_DATA=.data-verify PORT=4440 node --experimental-strip-types src/server.ts
```

Ready when stdout prints `Idea Foundry dashboard at http://127.0.0.1:4440` and `GET /api/health` returns `"ok": true`. The empty data directory is seeded with five ideas before the process listens. No migration step.

Tear down with the process you started. `kill` that pid. Do not kill every `node` process. Remove `.data-verify` after the run. Leave files under `screenshots/` in place.

`npm run e2e` launches its own server on port 4440 with `FOUNDRY_DATA=.data-e2e` and stops it when Playwright finishes. Do not start the manual server at the same time.

## Doctor

```bash
curl -sS http://127.0.0.1:4440/api/health
```

A healthy instance returns HTTP 200, `"ok": true`, `"port": 4440`, and `"ideas"` of at least 5. If the port is closed, start the server again. If `ideas` is 0, the data directory was not empty of a broken snapshot. Remove that directory and launch again.

`node --experimental-strip-types scripts/check-g0.ts` answers a different question. It checks that only `src/store.ts` writes files. Run it when a change touches `src/`.

## Drive

Prefer accessible names. The board buttons use the idea title. Spec lanes expose `Dispatch` and `Record outcome`. The merge control is `Merge pull request`.

The scripted drive for the add-idea feature is:

```bash
node --experimental-strip-types scripts/verify-drive.ts
```

It listens on port 4450 so it does not attach to a server you already started. It writes `screenshots/verify-add-idea.png`, then closes its server and deletes its temp data directory. The png remains.

The full board walk is:

```bash
npm run e2e
```

That run records `test-results/**/video.webm` and the stills in `screenshots/01-board.png` through `screenshots/04-verified.png`.

CLI drive, with `FOUNDRY_DATA` pointed at a fresh directory:

```bash
node --experimental-strip-types src/cli.ts idea "indoor plant log" --data "$FOUNDRY_DATA"
node --experimental-strip-types src/cli.ts restate i-0001 --data "$FOUNDRY_DATA"
node --experimental-strip-types src/cli.ts approve i-0001 --note "Use the fixture only" --data "$FOUNDRY_DATA"
```

`--dry-run` prints the next JSON and leaves the data directory unchanged. Confirm that by reading `state.json` before and after.

## Evidence

Capture the action and the state after it.

- Dashboard proof is a screenshot that shows the idea title and its state, plus the health JSON from doctor.
- CLI proof is the command, the JSON stdout, and a second `foundry show` of the same id.
- A gate or ingest claim needs the spec id in the response and the state read back from `GET /api/state` or `foundry show`.
- The merge refusal is HTTP 403 with a `next` string. A 200 from `POST /api/merge` is a failure.
- `foundry` does not open a network call for ingest. The draft flag comes from the report body. Confirm a `draft: false` report leaves the spec `dispatched`.

Mocks are not used. The planner is the deterministic fixture planner. TLC, when a gate runs, is the real `model/foundry.tla` check.

## Cleanup

Stop the server you started and delete the data directory you passed as `FOUNDRY_DATA` or `.data-verify`. Do not delete `screenshots/`. `scripts/verify-drive.ts` deletes only its temp data directory.

## Helpers

`scripts/verify-drive.ts` is the add-idea drive. Run it with the command in Drive. It exits 0 only after the restatement question is visible and the proof png is still on disk after the server stops.
