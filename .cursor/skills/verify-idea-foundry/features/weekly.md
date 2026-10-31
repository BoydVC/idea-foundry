# Weekly

`foundry weekly` answers what moved since a date: ideas, verified specs, open draft pull requests, and stale dispatches.

## Sub-features

- counts: JSON fields `ideasMoved`, `specsVerified`, `openDraftPrs`, and `staleDispatched`.
- bookmarks: `foundry import --from` dedupes a bookmark export by id.

## How to get to it (user POV)

- CLI only. There is no weekly button on the board.
- `foundry weekly --since 2026-10-24` after `foundry seed`.

## Driving it with the CLI

Preconditions: `foundry seed` on a fresh `FOUNDRY_DATA` directory. The seed uses synthetic titles.

```bash
npx tsx src/cli.ts --data "$FOUNDRY_DATA" weekly --since 2026-10-24
```

Result: `ok` is true and the four counts are numbers. On a seed from this month, `ideasMoved` is greater than 0 and `specsVerified` is 0.

Import the synthetic bookmark file twice:

```bash
npx tsx src/cli.ts --data "$FOUNDRY_DATA" import --from fixtures/x-bookmarks.json
npx tsx src/cli.ts --data "$FOUNDRY_DATA" import --from fixtures/x-bookmarks.json
```

The second command reports `count: 0`.

## Gotchas

- `--since` is `YYYY-MM-DD`. A missing date is status 400.
- Stale means a dispatched spec whose update is more than 7 days before `--since`.
- Bookmark ids are synthetic. Do not import a real export that contains personal data.
