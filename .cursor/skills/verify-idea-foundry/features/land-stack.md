# Land a stack

Land a stack moves an approved idea through decompose, G1 to G3, dispatch, and a draft ingest. The lower spec verifies before the upper spec.

## Sub-features

- `stack-decompose` shows two or more spec lanes. Lane 1 reads `1 lands first`.
- `stack-gates` shows `G1 pass`, `G2 pass`, and `G3 pass` on each lane.
- `stack-order` refuses a verified ingest of a higher spec while the lower spec is not verified.
- `stack-draft` refuses `draft: false` and accepts `draft: true`.

## How to get to it (user POV)

- Restate an idea, choose `Approve`, then `Decompose`, then `Run gates`.
- On lane 1 choose `Dispatch`, leave the draft box checked, and choose `Record outcome`.
- Repeat for the next lane.
- The idea card moves to the `verified` column only after every lane is verified.

## Driving it with Playwright

Preconditions:

- The idea is `restated` and the approval note field is filled. The board prefills `Use the fixture only`.
- TLC can run. The first `Run gates` calls Java. Allow 30 seconds.

- **Approve and decompose.** Choose `Approve`, then `Decompose`. The text `1 lands first` is visible.
- **Gate.** Choose `Run gates`. Each lane shows `G1 pass`, `G2 pass`, and `G3 pass`.
- **Land from the bottom.** Choose the first `Dispatch`, then `Record outcome`. The lane text includes `verified`. Choose the remaining `Dispatch`, then `Record outcome`.
- **Proof.** The `verified` column contains a button named with the idea title. `GET /api/state` shows that idea's `state` as `verified` and each spec `draftPr` as true.

## Gotchas

- Recording the upper spec first returns an error and leaves that spec `dispatched`. Do not mark the stack verified.
- Clearing the draft checkbox returns an error. The spec stays `dispatched`.
- `Run gates` on an idea that is already `verified` is not the path. Gate while the idea is `specced`.
