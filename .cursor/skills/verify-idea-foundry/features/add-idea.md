# Add an idea

Add an idea puts a new raw card on the board and can restate it into three questions.

## Sub-features

- `add-open` shows the seeded board and the title field.
- `add-save` creates a raw idea from the title.
- `add-restate` shows the restatement and three questions.

## How to get to it (user POV)

- Open `http://127.0.0.1:4440/`.
- Type a title and choose `Add idea`.
- Choose the new card, then `Restate`.
- Or run `foundry idea` and `foundry restate` against the same data directory.

## Driving it with Playwright

Preconditions:

- Doctor reports at least five ideas.
- No card is titled `indoor plant log`.

- **Open the board.** Go to `/`. The heading `Idea Foundry` is visible and a button named `habit tracker export` is visible.
- **Add the idea.** Fill the textbox `Title` with `indoor plant log` and choose `Add idea`. A button named `indoor plant log` appears, and the status names the new id.
- **Restate.** Choose that button, then `Restate`. The text `Which output file should indoor plant log write?` is visible, and the card sits in the `restated` column.
- **Proof.** Screenshot the selected idea. The png shows `indoor plant log` and `restated`.

## Gotchas

- The placeholder `indoor plant log` is not a saved idea. Assert the card button, not the placeholder.
- After `Add idea`, the status line is the id. The card is the proof that the board stored it.
- `foundry idea --dry-run` prints an idea and does not add a card. Check `state.json` if the claim is a write.
