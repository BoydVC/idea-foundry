# Refuse merge

Refuse merge is the safety check. The dashboard offers a merge button. The server refuses it, and it also refuses deploy and send.

## Sub-features

- `merge-button` shows HTTP 403 on the page.
- `merge-api` refuses `POST /api/merge`, `POST /api/deploy`, and `POST /api/send`.

## How to get to it (user POV)

- Scroll to `Out of reach`.
- Choose `Merge pull request`.
- Read the status under the button.

## Driving it with Playwright

Preconditions:

- The dashboard is open. The board does not need a verified idea for this check.

- **Ask to merge.** Choose `Merge pull request`. The status under the button contains `403`.
- **Ask the API.** `POST /api/deploy` and `POST /api/send` with a body of `{}` also return 403 and a `next` string.
- **Proof.** The screenshot or the response body shows 403. A later `GET /api/state` still has the same `version` as before the refused post.

## Gotchas

- A 403 page with no `next` string is incomplete. The body must say a person does this step.
- Do not add a route that returns 200 for merge, deploy, or send in order to make a test pass.
