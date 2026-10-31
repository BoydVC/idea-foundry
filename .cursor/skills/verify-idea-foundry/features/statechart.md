# Statechart

The statechart is drawn from `model/foundry.tla`. The mermaid file and the picture use those edges.

## Sub-features

- `chart-show` lists the edges, including restate.
- `chart-invariants` names the four TLC invariants.
- `chart-source` shows the mermaid text.

## How to get to it (user POV)

- Open the dashboard and go to the heading `Statechart`.
- Open Mermaid source if you want the text.

## Driving it with playwright

Preconditions:

- Doctor is green.

- **See the chart.** The statechart region contains `restate` and the line `Checked by TLC` includes `StackLandsBottomUp`.
- **Match the file.** Run `npm run check:chart`. It exits 0 only when `statechart.mmd` matches the chart comments in `model/foundry.tla` and the domain table.

## Gotchas

- A missing `model/foundry.tla` leaves the chart empty. Treat that as a failed launch, not as an empty product state.
- Do not hand-edit `statechart.mmd`. Run `npm run statechart`.
