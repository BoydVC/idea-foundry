# Idea board

The idea board lists every idea and lets a person add one, restate it, and approve it.

## Sub-features

- `board-list` shows the seeded ideas.
- `board-add` adds an idea in the raw state.
- `board-restate` shows a restatement and three questions.
- `board-approve` stores a note and moves the idea to approved.

## How to get to it (user POV)

- Open `http://127.0.0.1:4440`.
- Use the New idea field and the Add idea button.
- Use Restate and Approve on the idea card.

## Driving it with playwright

Preconditions:

- Doctor is green and the board lists `habit tracker export`.
- No idea is titled `pomodoro focus timer`.

- **See the board.** Open the dashboard. Run `npx playwright test e2e/dashboard.spec.ts`. The heading `Idea board` is visible and an article named `habit tracker export` is on the board.
- **Add an idea.** Fill `New idea` with `pomodoro focus timer` and choose `Add idea`. The article named `pomodoro focus timer` has `data-state` `raw`.
- **Restate.** Choose `Restate` on that article. The article state is `restated` and three questions are visible.
- **Approve.** Fill `Approval note` with `Ship the timer only.` and choose `Approve`. The article state is `approved`.
- **Confirm the store.** Run `control.sh get /api/state`. The JSON includes `pomodoro focus timer` with state `approved` after those three actions, or a later state if the stack-lanes journey continued.

## Gotchas

- Seeded ideas are already past raw. Restate is only on the idea you just added.
- The article locator must use the idea title. Several cards have a Run gates button.
- Add idea selects that idea's stack. All specs returns the full lanes.
