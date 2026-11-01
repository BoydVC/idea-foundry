# Idea Foundry

Idea Foundry turns one raw idea into an ordered stack of small specs, runs the static gates, and writes a draft arena packet. It does not merge, deploy, or send anything.

## Prerequisites

- Node.js 20 or newer
- JDK 21 on `PATH` as `java`, for `npm run tlc` and `npm run tlc:mutant`. When `java` is missing outside CI, those commands print `SKIP: Java is not on PATH` and exit 0. CI treats a missing JDK as an error.
- `tesseract` and `ffmpeg`, for `npm run pii` (it OCRs `screenshots/demo.gif`) and for `scripts/record-demo.ts` (it rebuilds that gif from the recorded video). A missing tool exits with a JSON error that names the tool and these prerequisites.

`foundry dispatch` reads open draft pull requests for the target repo and refuses with status 409 when that count is above 10. Set `FOUNDRY_OPEN_DRAFTS` only in tests and the local demo. An unreachable GitHub API prints a warning and still dispatches. Ingest does not verify unless GitHub confirms the pull request is a draft. A missing `gh`, a timeout, a network failure, or a non-JSON body leaves the spec dispatched with `github_unconfirmed`. `FOUNDRY_GITHUB_DRAFT=offline` is test mode, labeled in the output, and is the only path that uses the report line. Re-ingest of a verified spec is a no-op. Pass `--unverify` to leave verified after GitHub confirms it is closed or no longer a draft. HTTP 403 is returned as 403.

## Run the pipeline

About two minutes from a raw idea to a Draft Day pick. This does not merge anything.

```bash
npm ci
npm run pipeline
```

The script restates, approves, decomposes, and gates `habit tracker export`, dispatches the bottom spec, and runs Draft Day's `dd intake --from-inbox` on that inbox line. Draft Day is unpacked from a GitHub tarball of `fa266c249405c25db0b900ce0cc5d3a0fd744ce7` into `vendor/draft-day` (`gh api repos/BoydVC/draft-day/tarball/<sha>`, or `https://codeload.github.com/BoydVC/draft-day/tar.gz/<sha>` when that call does not return a gzip). The unpacked tree is cached with a `.foundry-sha` marker. The printed JSON includes the pick id and `status: intake`.

A kill during the intake append leaves the spec dispatched and the packet on disk. The next Foundry command rewrites `intake.jsonl`: a torn last line moves to `intake.jsonl.torn`, and each dispatched or verified spec with a packet gets exactly one intake line rebuilt from `packets/<id>.json`. Draft Day's own reader still requires every line to be complete JSON. Run any Foundry command before `dd intake --from-inbox` so Foundry repairs the file first. `/api/health` and `foundry weekly` report quarantined line counts and warn when that count is above zero. The board shows that warning, with each file's count and the `.torn` path, when any count is above zero. `foundry quarantine --list` prints the same counts and paths. `foundry quarantine --clear` moves each `.torn` file to `.torn.archive`. A second clear leaves the archive as it is. A title may include a skin-tone emoji joiner, such as 👩🏽‍💻, and a zero-width non-joiner between Arabic or Indic letters, such as می‌خواهم. A joiner next to ordinary letters is still rejected.

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

`ingest` accepts only `https://github.com/<owner>/<repo>/pull/<number>`. It asks the GitHub API whether that pull request is a draft, including when the spec is already verified. When the API answers, that answer wins. When GitHub says the pull request is closed or no longer a draft, re-ingest moves that spec from verified back to dispatched and reopens a verified idea. A higher spec must leave verified first, and that check is repeated after the GitHub call returns. An offline, 404, or non-GitHub answer does not un-verify. A rate limit or an HTTP 5xx response does not use the report line and does not un-verify. Re-ingest a verified spec with the pull request URL already stored on it. When GitHub cannot confirm the pull request, the spec stays in its current state and ingest returns github_unconfirmed. `foundry ingest <id> --recheck` retries the stored report without passing `--report` again. `--unverify` while GitHub is offline says the spec stays verified. Pass `--version` or `--record-version` to send the record version you read. A mismatch returns 409. A version that is present but not an integer returns 400. `foundry gate` runs TLC on `model/foundry.tla`, fails the gate when TLC fails, and fails a spec that shares a touch path with another spec in the stack. `foundry dispatch` appends `{idea, source, target, n}` to `intake.jsonl` only after the compare-and-swap succeeds.

`foundry import` reads a JSON file (`bookmarks` or `notes`) or a markdown file of `#` headings and restates each item into one line: a problem and a done-when. A file of `{id, text}` bookmarks without `--from` returns `bad_import` and tells you to run `foundry import --from <file>`. `foundry import --from bookmarks.json` reads a bookmark export of `id`, `author`, `text`, and `date`, and skips ids it has already stored. The cap is 10000000 bytes on disk, checked with stat before the file is read. It is not a count of UTF-16 characters. Idea ids stay `i-0001` and continue through `i-10000` and beyond. The repo fixtures are synthetic.

```bash
npm run foundry -- import fixtures/bookmarks.json
npm run foundry -- import fixtures/notes.md
npm run foundry -- import --from fixtures/x-bookmarks.json
npm run foundry -- weekly --since 2026-10-24
npm run foundry -- correct
```

`FOUNDRY_PLANNER=fixture` (the default) is the offline planner. `FOUNDRY_PLANNER=agent` restates in its own words and sketches types and signatures. Point `FOUNDRY_PLANNER_RECORD` at a JSON file to replay a recorded response. `FOUNDRY_PORT` chooses the dashboard port. `foundry correct` writes lesson proposals under the data directory and does not apply them. `foundry weekly` prints ideas moved, specs verified, `localDraftPrs` for this store, `targetOpenDrafts` for the target repo, and dispatched specs older than 7 days. `foundry idea` warns when the title matches an idea already on the board; pass `--allow-duplicate` to skip the warning. `foundry seed` refuses a store that already has ideas unless you pass `--fresh`.

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

`npm run tlc:mutant` passes only when `foundry_skip_gate.cfg` violates `DispatchRequiresGate`, `foundry_merge.cfg` violates `NoMergeState`, `foundry_lost.cfg` violates `CASNoLostUpdate`, and `foundry_undo.cfg` violates `VerifiedIsFinal`. All four configs use `model/foundry.tla`.
