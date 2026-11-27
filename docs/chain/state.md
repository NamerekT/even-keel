# Chain: what the dispatcher owns and its state files

## What the dispatcher owns (invariant 2)

The tracker is the source of truth for statuses; the dispatcher keeps no status of its own. It owns only what is listed here, with its storage key. **Something new the dispatcher must remember goes on this list, never into a status.**

**The order and its tasks**

- the chain order, the pause, the list of skipped tasks;
- released tasks awaiting cleanup and their resting sessions eligible for a handover on return (`released`, `shelved`, with the release reason and blockers; [Released tasks](entry.md#released-tasks));
- cleanup warnings and the worktree folders a cleanup after Done left held, until removed or warned about (`leftovers`, `left_folders`, BTN-925, [cleanup](cleanup.md));
- the tasks it closed by a merge, with the commits `main` had of their branches then (`merge_closes`, [cleanup](cleanup.md));
- unattended mode and the "trim the tools" switch;
- the run of each task that has one — the provider, model and effort its sessions start on (`task_runs`, BTN-983, `docs/sessions/models.md`), and the projects whose run labels are still to be moved into runs (`run_label_imports`).

**The tracker**

- the questions it posted to the tracker;
- the GitHub issues it took into a tracker until they are closed, with whether each came from an outsider; an outsider's closed issue is kept until its task is done (`IntakeEntry.outsider`, `closed`, BTN-1207, `docs/trackers.md`).

**Pull requests and landings**

- the pull requests it opened for tasks in PR mode (`reviews`, [PR mode](pr-mode.md));
- the landings of merges that have not gone through: the rounds a task went back to its session, whether it resolves a conflict or a red check (`resolving`), the message not delivered yet, whether it waits for a remote out of reach (`waitingRemote`) and the next try (`landings`, BTN-1581, [Landing](worktrees.md#landing-btn-1581));
- in memory: the landed merges whose task is not closed yet, for the page (BTN-1779).

**CI and fixes of main** ([main-ci](main-ci.md))

- per project (`ci[<project>]`): the last green commit, the push it waits on (for the CI or the project's own check), the last red commit whose failed jobs it reran (`rerun`, BTN-846), the start and end of the last run of `commands.afterGreen` (`afterGreenRun`, BTN-829);
- the last green commit each machine elsewhere was sent to run `afterGreen` on (`project_machines.after_green`, BTN-994, `docs/machines/landings.md`, "After a green main");
- the fix of a red main — the session it started or the task it created — with the task whose session it stopped for the fix (`fix`);
- the fix and carry sessions the user skipped, until their worktree is cleaned up (`skippedSessions`);
- in memory: the carries of release projects it holds after a conflict ([Carrying a release project forward](projects.md#carrying-a-release-project-forward-mergeinto-btn-172-srcchainforwardts)).

**Machines** (`docs/machines.md`)

- the machines it gave a connection token and the commands they have not confirmed (`machines`, `machine_commands`, BTN-988), and the machine this installation itself is (`machines.own`);
- the machines each project may run on and the machine each task went to with its launch, until its place there is cleaned up (`project_machines`, `machine_tasks`, BTN-1216);
- the capacity of each machine elsewhere and the machine of each lane and of each launch (`machines.capacity`, `ActiveChain.machine`, `LaunchEntry.machine`, BTN-993);
- the tasks moved by hand off a machine gone, with the machine left and the branch, until their next launch and cleanup (`task_moves`, BTN-1270).

**Chats**

- the project chats — sessions without a task started from the page, with their account, model, effort, machine, title, last message and archive — and each project's last choice for a new one (`chats`, `chat_choices`, BTN-1230, `docs/sessions/project-chats.md`).

The current session views and the chat panel are the hub's in-memory mirror of what the machines send, not state of its own; how a machine's launch log, session windows and mailbox reach the hub as numbered events is in [the seam](../machines/seam.md) ("The chain over the link", "Moves").

### The built-in tracker is not the dispatcher's state

The built-in tracker (BTN-767, `docs/trackers.md`) keeps its tasks in the same state database, yet they are tracker data: the chain reads and moves them only through the `builtin` adapter, by the same actions as on any other tracker (start, pull request, merge, `ready`/`unready`, a comment), and the person changes them through the page's `builtin/*` commands. Nothing of the list above goes into a built-in task, and no status of one is written outside these actions.

### Switching a built-in project to another tracker

- When a built-in project switches to the tracker its tasks were copied into (BTN-1074), only the saved order, the skips and the tasks' runs move to the new ids (`Dispatcher.rename`, `TaskRuns.rename`).
- With no saved order, the computed one is saved (BTN-1195), ranking the backlog and the own waiting blockers with the chain after a manual order (BTN-1199: a target without Backlog puts them into the chain, where unranked they would be new and go first).
- The switch is refused while the chain runs or holds a task of the project (the current one, a released or shelved one, an open pull request).
- Everything else that names a task by id — launches, `closed_tasks`, `merge_closes`, handoffs, questions — keeps the old id, linked to the new one by `tracker_export_tasks`.
- The switch after an import into the built-in tracker (BTN-1405) is held by the same refusals. The tasks keep their numbers under the project's key, so ids change only where the source's own differ from `<key>-<number>`; those move the same way. The import's progress (`tracker_imports`, `tracker_import_tasks`) is the dispatcher's own until the switch, which drops it; the source's tasks are never written to.

## State files and the schema version (BTN-132)

Since BTN-147 the chain state, the questions, the launch log and the handoff snapshots are in the state database (`state/even-keel/`, `docs/storage.md`). `state/chain.json`, `questions.json` and `launches.jsonl` are what v0.1 kept: the first start of a newer version imports them and renames them `*.imported`. The config, `account.json`, `packages.json`, `rate-limits.json` and `codex/` are still files. Everything below holds today.

- **A project has a key and an id.** The key (`ABC`) is not unique since BTN-271; the id (`projects[].id`) is a GUID that never changes. The database (`project_id` of its tables), the imported files (`active[].project`, `queue`, the keys of `orders`, `skipped`, `leftovers`, `released`, `ci`; `project` of a launch), every map of `EvenKeelConfig` (`config.keys` gives the key of each id), the dispatcher, the page's state and its URLs name a project by its id. Task IDs, branches and worktrees go by the key; the tracker adapters get each id's key and value (`TrackerPlace`). An id the config does not have — a removed project — stays as it is.
- **Every file carries the schema version** (`SCHEMA_VERSION`, `src/storage/schema.ts`): `version` in the config, `chain.json`, `questions.json` (`{ version, questions }`), `account.json`, and the first line `{"version":<N>}` of `launches.jsonl`. A file newer than the code is refused (`storage.newer`). The database has its own version (the one row of `schema_version`, `docs/storage.md`).
- **`upgradeStorage`** (`src/storage/migrations.ts`) runs in `src/start.ts` before `src/service.ts` is imported. It reads all the files, migrates them step by step to the current version, checks the config with `parseConfig`, keeps `<file>.v<N>.bak` copies and writes them all, restoring the written ones if a write fails. It also writes an id into a project entry added by hand without one.
- **A refusal blocks the page.** Any refusal (`storage.newer`, `storage.damaged`, `storage.unknownProject` — a project of the state the config lacks, `storage.writeFailed`) starts only the blocked page server (`createBlockedServer`, `src/server.ts`): the page from `dist/web`, `/api/events` sends `blocked` with the reason, the rest of `/api` is 503. Right after `upgradeStorage`, `prepareDatabase` brings the database to its schema or imports the files into it; its refusals (`storage.newerDatabase`, `storage.importFailed`) block the same way.
- **A format change** is a new schema version, a migration step and a new frozen sample in `test/fixtures/schema-v<N>/` (`src/storage/fixtures.test.ts`); old steps and samples are never edited or removed. Schema v8 (BTN-173), for example, turned a project's `agent` into the run profile's `provider` (`docs/sessions.md`).
- **A launch log entry may carry `fallback`** — the provider of the task's run label the pool had no account for; `fallbacksSince` gives the page the last 24 hours of them.
