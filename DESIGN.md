# Type model

`src/domain.ts` is the only place a phase can change. `transition(state, event)` switches on every event and every phase. Illegal pairs throw `IllegalTransition` and name the next command. The legal edges are the same set as the actions in `model/foundry.tla`, and `model/statechart.mmd` is generated from those actions.

Ids are branded strings. `i-0001` is not a `SpecId`. `parseIdea` and `parseSpec` are the boundary. A verified spec must carry `draft: true`, an https pull request URL, a packet path, and passing G1, G2, and G3 results. A lesson exists only after a finding key has been seen twice, and `promotedTo` has to match that key's gate.

`store.ts` is the only module that writes files. A writer passes the version it read. If the stored version differs, the write returns 409 and the previous record stays. The fast-check test retries concurrent label updates and checks that every label lands once.

The dashboard is a board, stack lanes, gate results, the generated chart, and the lessons ledger. `POST /api/merge`, `POST /api/deploy`, and `POST /api/send` return 403.
