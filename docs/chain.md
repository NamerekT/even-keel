# Chain

Reference for sessions: entry into the chain, order, task worktrees, cleanup and the details of the exceptions to invariant 1. The invariants themselves are in `CLAUDE.md`.

## Subtopics

The area is split by subtopic, a file each in `docs/chain/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`entry.md`](chain/entry.md) | Entry into the chain; Order; Task feeds; Status moves; Released tasks |
| [`worktrees.md`](chain/worktrees.md) | Task worktree; Cleanup after Done; "Slot" mode |
| [`pr-mode.md`](chain/pr-mode.md) | PR mode |
| [`main-ci.md`](chain/main-ci.md) | The CI of main; The fix session; The fix task |
| [`projects.md`](chain/projects.md) | Several chains; One folder, one project; Projects of one remote; Several projects on one tracker project; Carrying a release project forward; The carry session |
| [`exceptions.md`](chain/exceptions.md) | The exceptions to invariant 1 in detail |
| [`state.md`](chain/state.md) | What the dispatcher owns; State files and the schema version |
| [`unattended.md`](chain/unattended.md) | Unattended mode |
| [`e2e.md`](chain/e2e.md) | End-to-end tests |
