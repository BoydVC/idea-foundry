# Idea Foundry verification map

Drive the dashboard the way a person does. Read this index, then the feature file.

## Baseline preconditions

- Launch with `FOUNDRY_FRESH=1` and `FOUNDRY_SEED=1` on a new `FOUNDRY_DATA` directory.
- Default proof port is 4460. The committed demo uses 4440. Do not share a data directory between runs.
- Seed titles are generic product names. Do not type a personal name into the form.
- Run doctor and require `service` `idea-foundry` before any click.
- `POST /api/merge` returns 403. There is no merge button.

## Driving conventions

- Start from the seeded board unless the feature file says otherwise.
- Use `data-testid` values from the skill.
- Treat commands as literal.
- Proof artifacts stay in `screenshots/proof/` after the server stops.

## Features

- [add-idea](add-idea.md)
- [stack-and-gates](stack-and-gates.md)
- [draft-ingest](draft-ingest.md)
- [lessons](lessons.md)
