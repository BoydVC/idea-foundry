# Add idea

The form creates a raw idea and selects it on the board.

## Sub-features

- add-raw: a non-empty title becomes a card in the raw column.
- reject-blank: an empty title shows the banner and writes no idea.

## How to get to it (user POV)

- Open the dashboard. The form is under the title.
- The same write is `foundry idea "<title>"`.

## Driving it with Playwright

Preconditions: doctor passed, seed is loaded, and you know the next id from `GET /api/state` (`nextIdea`, formatted `i-` plus four digits).

- Fill `add-idea-title` with `unit converter card` and click `add-idea-submit`. Result: a card `idea-<id>` is visible and the detail line contains `raw`.
- Read `GET /api/state`. Result: that id exists with `state` `raw` and the same title.
- Clear the field and submit again. Result: the banner is visible and the idea count does not grow.

## Gotchas

- The placeholder text is not a saved idea. An empty submit must not create "habit tracker export".
- Titles that look like an email address are rejected. Use a product name.
- If the next id is not the one you expected, another writer used the same data directory. Start a fresh directory.
