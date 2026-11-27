# Chain

How the dispatcher runs a project's tasks one after another: for a chain session and for a person changing the code. The invariants themselves are in `CLAUDE.md`.

## Subtopics

The area is split by subtopic, a file each in `docs/chain/`: read this page, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. A file stays under 40 KB (`scripts/docs-size.test.ts`) so that it is read whole.

| File | What is in it |
| --- | --- |
| [`entry.md`](chain/entry.md) | Entry into the chain; the backlog and the archive on the page; Order; Task feeds; Status moves; Released tasks |
| [`launch.md`](chain/launch.md) | Pauses and waits before a launch; what a running chain waits for |
| [`background.md`](chain/background.md) | A turn that ended on a background command (`shell`): when it holds the chain and when not |
| [`worktrees.md`](chain/worktrees.md) | Task worktree; Task branches on the remote; Landing; "Slot" mode |
| [`cleanup.md`](chain/cleanup.md) | Cleanup after Done: closing the task, stopping its sessions, removing its folder, `git sync`, work left behind |
| [`no-git.md`](chain/no-git.md) | A project without git, turning git on |
| [`pr-mode.md`](chain/pr-mode.md) | PR mode |
| [`main-ci.md`](chain/main-ci.md) | The CI of main; The fix session; The fix task |
| [`projects.md`](chain/projects.md) | Several chains and lanes; One folder, one project; Projects of one remote; Several projects on one tracker project; Carrying a release project forward; The carry session |
| [`exceptions.md`](chain/exceptions.md) | The exceptions to invariant 1, the writes without a stop, keep-warm, a restart mid-move, what a handoff leaves |
| [`state.md`](chain/state.md) | What the dispatcher owns; State files and the schema version |
| [`unattended.md`](chain/unattended.md) | Unattended mode |
| [`e2e.md`](chain/e2e.md) | End-to-end tests: which files to run, reading a failed run, the fixtures |
| [`e2e-cli.md`](chain/e2e-cli.md) | Real CLIs (`src/e2e-cli/`) |
| [`demo.md`](chain/demo.md) | The demo on the first run: its folder, project, agent, scenario, page and removal |

## Words of the area

Every file of the area uses these words in this sense and does not explain them again.

- **`main`** — the project's main branch: its `branch` key (BTN-117), `main` without it. Every git call takes it from the current config, so a change applies without a restart.
- **Mid-turn** — the session's status for the chain is `busy` (`MachinePort.midTurn`): a model request or a tool call is under way, or the turn ended while a background command the session started still runs ([`background.md`](chain/background.md)). A session waiting on a question (`waiting`) is not mid-turn.
- **Busy** — mid-turn or waiting on a question (`MachinePort.busy`). The cleanup after Done and the stop of a parent's session take a turn that ended on a background command for over (`MachinePort.shell`).
- **Idle** — neither: the turn ended on a message, a mark or an error.
- **Lane** — one running chain of a project, an entry of `active` in the chain state with its machine. A project runs up to its `width` of lanes at once, each with its own current task ([`projects.md`](chain/projects.md), "Lanes").
- **Released** — a task the chain started and let go other than through Done: skipped, postponed by a blocker, back in an inactive status, a parent now, or its chain stopped or halted. It is kept in `released` until it is Done (and cleaned up) or forgotten ([`entry.md`](chain/entry.md), "Released tasks").
- **Shelved** — a released task whose idle session the chain remembers in `shelved`, to hand the task over to a new session when it comes back (exceptions 9 and 10).
- **Let go** (`letGo`) — the task is set aside out of the chain's order with its session untouched: a pull request opened, a session a fix of main does not stop.
- **Loose session** — the live session of a task whose chain is stopped. The page marks its row `loose` and keeps its chat (exception 6).
- **Handoff** — a new session of the same task in the same folder, its prompt carrying the previous session's last message, steps and note (`src/chain/relay.ts`); `relay` in the launch log. A **resume** is `--resume` of the same session. `Handovers` is the code of both.
- **Warm** — the session's cache is still warm by the rule of exception 1: then the chain resumes the session, otherwise it makes a handoff.
- **Launch log** — the state table `launches` (`docs/storage.md`): every launch, resume, handoff and the end of a fix or carry, with its reason.
- **Monitor** — the session monitor (`wireMonitor`, `src/service/session-monitor.ts`): each tick it lists the sessions and reads their transcripts into the views the chain decides by.
- **Lamp** — the session's state on the page (`working`, `waiting`, `limit`…; `docs/web.md`).
- **Pause and wait.** A pause stops the chain until a person acts or its cause clears (`halt`, the notice on the page). A wait holds only the next launch and passes by itself (`ciWait`, `limitUntil`, `slotWait`…; [`pr-mode.md`](chain/pr-mode.md), "What a running chain waits for").
