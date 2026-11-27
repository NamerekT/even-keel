# CI

Even Keel watches the CI of each project and shows it on the page (BTN-102). After a push of `main` the chain waits for the verdict of the counted CIs before the next launch, and a red `main` is fixed first — by a session without a tracker task, or by a fix task when the project asks for one (BTN-103, BTN-115): how the chain behaves is in `docs/chain/main-ci.md`, "The CI of main". Without a CI to judge `main`, the project's own check commands do (BTN-104).

## Terms

- **Settle** — one pass of `MainCheck` over the awaited pushes, at each step of the dispatcher.
- **Place** — a task's worktree or slot (`docs/chain.md`).
- **Lane** — one running task of a project whose `width` is over 1 (`docs/machines/pool.md`).
- **Late watch** — a push the chain left unchecked, still watched so that a verdict that comes later counts (`workflows.md`, "Polling").
- **Mirror** — a later CI on the same commit with the same finished status, folded on the page into one line (`workflows.md`, "The page").

## Subtopics

The area is split by subtopic, a file each in `docs/ci/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`layer.md`](ci/layer.md) | The layer and the adapters' contract, the branch protection audit, which CIs the chain counts, the check without a CI, commands after a green main, a push by hand, which CI a project has and its token, git over HTTPS |
| [`workflows.md`](ci/workflows.md) | This repository's workflows and the release gate of the nights, polling, Forgejo traps, the page |
