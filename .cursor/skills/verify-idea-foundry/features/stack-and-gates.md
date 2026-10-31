# Stack and gates

Decompose builds 2 to 6 spec lanes. Gate turns a passing lane green.

## Sub-features

- decompose: an approved idea gains lanes `spec-<id>` ordered from the bottom.
- gate-pass: each lane shows `G1 pass`, `G2 pass`, and `G3 pass`.

## How to get to it (user POV)

- Select an idea, then Restate, Approve, Decompose, and Run gates.
- CLI: `restate`, `approve --note`, `decompose`, `gate`.

## Driving it with Playwright

Preconditions: a raw idea you just added, for example `i-0006` on a fresh seed.

- Click `action-restate`. Result: the detail contains `In our own words`.
- Click `action-approve`. The note field already says `Ship the smallest slice`. Result: the phase line contains `approved`.
- Click `action-decompose`. Result: `spec-s-0006-1` is visible and its text contains `bottom`.
- Click `action-gate`. Result: `gate-s-0006-1-G1`, `G2`, and `G3` each contain `pass`.

## Gotchas

- Run gates before dispatch. A specced lane has no Dispatch button.
- Gate calls the optional review endpoint and continues when that port is closed. A red gate is a spec failure, not a closed review port.
- The bottom lane is index 1. Later lanes name the spec below them.
