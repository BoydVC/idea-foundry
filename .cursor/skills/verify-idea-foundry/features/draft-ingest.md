# Draft ingest

Dispatch writes an intake packet. Ingest records a draft pull request and walks the stack from the bottom.

## Sub-features

- dispatch: a gated spec becomes `dispatched` and a packet file exists.
- ingest-draft: a checked draft box moves that spec to `verified`.
- refuse-published: an unchecked draft box leaves the spec dispatched.
- stack-order: a higher spec stays put until the spec below it is verified.

## How to get to it (user POV)

- On a gated lane, click Dispatch, leave the draft box checked, and click Ingest.
- CLI: `dispatch <spec-id>` then `ingest <spec-id> --report <file> --pr <url>`.

## Driving it with Playwright

Preconditions: `s-0006-1` shows G1, G2, and G3 pass.

- Click `dispatch-s-0006-1`. Result: `ingest-s-0006-1` is visible.
- Click `ingest-s-0006-1` with `ingest-draft-s-0006-1` checked and the pr field `https://example.com/demo/pull/1`. Result: the lane text contains `verified`.
- Repeat dispatch and ingest for `s-0006-2` and later slices in order. Result: after the last slice, the detail line contains `i-0006 · verified`.
- Uncheck the draft box on a dispatched spec and ingest. Result: the banner says the pull request is not a draft and the lane stays `dispatched`.

## Gotchas

- Ingest of slice 2 before slice 1 is verified returns `stack_order`. Verify the bottom slice first.
- The pr field must be https. `example.com` is the fixture host.
- `POST /api/merge` is 403. Do not look for a merge button.
