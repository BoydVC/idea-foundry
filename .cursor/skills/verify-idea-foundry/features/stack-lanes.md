# Stack lanes

Stack lanes show each spec in specced, gated, dispatched, verified, rejected, or parked. Dispatch and draft ingest happen on the spec card.

## Sub-features

- `lanes-show` places specs in a sideways scroller on a phone-width window.
- `lanes-dispatch` writes an arena packet for a gated spec.
- `lanes-order` refuses to verify a higher spec first.
- `lanes-verify` records a draft pull request and can move the idea to verified.

## How to get to it (user POV)

- Open the dashboard and go to the heading `Stack lanes`.
- Choose `Decompose` and `Run gates` on an approved idea.
- Choose `Dispatch` and `Record verified draft` on a spec card.

## Driving it with playwright

Preconditions:

- The idea `pomodoro focus timer` is approved. Follow the idea board journey first.
- Doctor is green.

- **Decompose and gate.** On the article named `pomodoro focus timer`, choose `Decompose`, then `Run gates`. Two spec articles appear and each shows `G1 pass`.
- **Dispatch both.** Choose `Dispatch` on the article whose name contains `Show pomodoro focus timer on the board`, then on the article whose name contains `Define the acceptance command for pomodoro focus timer`.
- **Refuse the upper spec.** Choose `Record verified draft` on the upper spec. The status mentions that a higher spec cannot be verified yet.
- **Verify from the bottom.** Choose `Record verified draft` on the lower spec, then on the upper spec. Both articles show `data-state` `verified`, and the idea article does too.
- **Confirm the packet.** Run `control.sh cli dispatch <lower-spec-id>` after a fresh gated spec. Stdout JSON has `draftOnly` true and an intake line with `source` `foundry`.

## Gotchas

- Verifying the upper spec first is a real failure. Do not skip that click to make the journey look green.
- Record verified draft sends a draft report. A report with `draft: false` stays dispatched. Prove that with `control.sh cli ingest` and a fixture file, not with the button.
- The lanes scroller is allowed to scroll. The page itself must not grow sideways at 390 pixels.
