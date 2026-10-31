---
name: verify-idea-foundry
description: Drive the Idea Foundry dashboard on port 4440 and the foundry CLI. Use when checking the idea board, stack lanes, gate chips, lessons ledger, statechart, or the add-idea path through a verified draft.
---

# Verify Idea Foundry

The primary surface is the dashboard at `http://127.0.0.1:4440`. The `foundry` CLI writes the same store. Drive the panels in `.cursor/skills/verify-idea-foundry/features/` with Playwright. Use `helpers/control.sh` for health checks and CLI calls.

## Launch

From the repo root, with an empty data directory:

```sh
rm -rf .tmp/verify
node src/cli.ts serve --port 4440 --data .tmp/verify --seed
```

Ready when stdout prints `"ok":true` and `curl -fsS http://127.0.0.1:4440/api/health` returns `"service":"idea-foundry"`. `--seed` loads five generic ideas and 14 specs before the port opens. The page is usable when the idea board lists `habit tracker export`.

Tear the server down with the pid you started. Do not kill by process name.

```sh
kill "$PID"
```

A second verify run uses another data directory and another port. Do not point two runs at `.tmp/verify`.

## Doctor

```sh
.cursor/skills/verify-idea-foundry/helpers/control.sh doctor
```

Doctor succeeds only when health returns `idea-foundry`, the listener is on `127.0.0.1:4440`, and that port's pid is the server you started. If doctor fails, do not drive the board.

## Drive

Prefer accessible names.

- New idea is the textbox named `New idea`. Add idea is the button named `Add idea`.
- An idea card is an article named with the idea title.
- A spec card is an article whose name starts with the spec id.
- Gate chips read `G1 pass`, `G1 fail`, or `G1 not run`, and the same for G2 and G3.
- Stack lanes are the region named `Stack lanes`.
- Lessons ledger is the region named `Lessons ledger`.
- Statechart is the region named `Statechart`.
- Status text is the status role.

Playwright base URL is `http://127.0.0.1:4440`. The suite that walks every panel is:

```sh
npx playwright test
```

CLI calls go through the helper so they share the verify data directory:

```sh
.cursor/skills/verify-idea-foundry/helpers/control.sh cli idea "habit tracker export"
```

## Evidence

Write proof under `screenshots/` and leave it there after cleanup.

- UI proof is a screenshot plus the status text or the article state after the action.
- CLI proof is the command, the JSON stdout, and the exit code.
- A mutation is proven when a second read, `foundry state` or `GET /api/state`, shows the new state.
- `foundry` commands with `--dry-run` must leave `state.json` unchanged. Check the file, not the flag name.
- The demo GIF is `screenshots/demo.gif`. It is 8 to 20 seconds and at most 5 MB. Frames show generic sample ideas only.

## Cleanup

Stop the pid you started and remove `.tmp/verify`. Do not delete `screenshots/`.

```sh
kill "$PID"
rm -rf .tmp/verify
```

## Helpers

`helpers/control.sh` is executable.

```sh
.cursor/skills/verify-idea-foundry/helpers/control.sh doctor
.cursor/skills/verify-idea-foundry/helpers/control.sh cli state
.cursor/skills/verify-idea-foundry/helpers/control.sh get /api/state
```

Keep the feature map honest with `/maintain-verification-skill` after the board changes.
