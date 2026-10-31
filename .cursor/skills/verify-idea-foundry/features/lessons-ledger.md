# Lessons ledger

The ledger lists a finding that has happened twice. The seed run gates the weather spec twice so `g2-vague` is already there.

## Sub-features

- `lesson-show` lists `g2-vague` under Lessons ledger.
- `lesson-empty` shows the empty sentence when the data directory has no lessons.

## How to get to it (user POV)

- Open the dashboard and go to the heading `Lessons ledger`.

## Driving it with playwright

Preconditions:

- Seed data is loaded.

- **Read the ledger.** The text `g2-vague` is visible and the row names gate `G2`.
- **Empty ledger.** Start a second server on another port with a fresh data directory and without `--seed`. The ledger says `No repeated finding yet`.

## Gotchas

- One failed gate does not write a lesson. The weather seed runs the gate twice on purpose.
- Do not delete the lesson to make the empty sentence appear on the seeded server. Use a second data directory.
