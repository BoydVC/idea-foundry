# Arena packet

Dispatch writes a draft packet with at least two runner seats and a verifier that picks a base and grafts.

## Sub-features

- seats: the packet lists `types-first`, `model-first`, and `experience-first`.
- verifier: `base` is `pick` and `graft` is true.
- intake: Draft Day's inbox line is still `{idea, source, target, n}` and `dd intake` returns `status: intake`.

## How to get to it (user POV)

- Gate a spec, then Dispatch on the bottom lane.
- CLI: `foundry dispatch <spec-id>`.

## Driving it with Playwright

Preconditions: a gated bottom spec, for example `s-0006-1`.

- Click `dispatch-s-0006-1`.
- Read `packets/s-0006-1.json` in the data directory. Result: `runners` has 3 seats and `verifier.graft` is true.
- The intake file's first line has `"source":"foundry"` and `"n":3`.

## Gotchas

- A packet with one runner is rejected.
- Dispatch returns 409 when the target has more than 10 open draft pull requests. The demo sets `FOUNDRY_OPEN_DRAFTS=0` so the seeded board can still dispatch.
- An unreachable GitHub API warns and still writes the packet.
