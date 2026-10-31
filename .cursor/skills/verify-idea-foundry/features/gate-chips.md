# Gate chips

Each spec card shows G1, G2, and G3 as pass, fail, or not run.

## Sub-features

- `chip-pass` shows G1 pass, G2 pass, and G3 pass on a clean spec.
- `chip-fail` shows G2 fail on the weather spacing spec.
- `chip-wait` shows G1 not run before Run gates.

## How to get to it (user POV)

- Open the dashboard with the seed data.
- Read the chips on a spec card in Stack lanes.
- Choose All specs if a single idea is selected.

## Driving it with playwright

Preconditions:

- The server was started with `--seed`.
- Focus is all specs. Choose `All specs` if a later journey changed the filter.

- **See a failure.** Find the text `G2 fail`. The weather spacing spec is still `specced`.
- **See a pass.** Find `G1 pass` on a habit export spec.
- **See a chip before a gate.** Add a new idea, approve it, and decompose it. Before `Run gates`, the new spec chips read `G1 not run`.

## Gotchas

- After you add an idea the lanes follow that idea, so the weather failure is hidden until you choose All specs.
- A red chip is the product working. Do not treat G2 fail on the weather seed as a broken board.
