# Lessons

A finding that shows up twice is stored and named as a gate.

## Sub-features

- ledger: the lessons list shows a key, a count, and the gate it was promoted to.

## How to get to it (user POV)

- Scroll to Lessons on the seeded board.
- The seed records `g2:vague-verb` twice.

## Driving it with Playwright

Preconditions: launch with `FOUNDRY_SEED=1` and doctor passed.

- Read `lessons`. Result: the text contains `g2:vague-verb`, `repeated`, and `G2`.
- Read `GET /api/state`. Result: `lessons[0].promotedTo` is `G2` and `count` is at least 2.

## Gotchas

- A single finding does not create a lesson. The seed applies the finding twice.
- If the list says `No repeated finding yet`, the server was started without the seed.
