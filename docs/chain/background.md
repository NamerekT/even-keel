# Chain: a turn that ended on a background command

The CLI writes the status `shell` into `sessions/<pid>.json` when the turn is over but a command the session started in the background (`run_in_background`) still runs; when the command ends, the session gets a notification and goes on.

## For the chain such a session is mid-turn

`turnStatus` (`src/sessions/agents.ts`) makes `busy` of `shell`, so a long run of 15–20 minutes is neither skipped nor cleaned up, and a slot with such a session is occupied. The exceptions:

- **Hung.** An hour without a new line in the transcript: the command counts as hung, the session as idle.
- **A limit.** A turn that ended on a limit is idle at once and goes by the limit rule (the lamp is `limit`): otherwise a command that never ends, a dev server, would hold the chain for good.
- **A mark the chain answers.** A turn whose last line is `CHECKPOINT:` or `PULL REQUEST:` is idle at once (BTN-959): the chain hands the task over or opens the pull request, and nobody needs the command's output. Before it, a session that left a hung stub in the background and ended on `CHECKPOINT:` was handed over an hour later.
- **A turn that ended on the user.** The CLI's summary marks the job `state: blocked` (`jobs/<id>/state.json`); with `shell` under it the session waits (status and lamp `waiting`). Before it, a session that ended its turn with "waiting for you to press Start" and a `Monitor` on the service log showed as working for half an hour.

## The end of the work does not wait for it (BTN-202)

A task in Done (`closing` and released tasks) and a fix session whose branch is in `main` do not wait for a session in `shell`: the status says the turn is over, and the merge or the Done says the work is. `DispatcherDeps.shell` tells the raw status apart from the `busy` `turnStatus` makes of it; `Cleanups.working` (`src/chain/cleanup.ts`) and `MainFix.follow` use it, and the cleanup's `stopTaskSessions` takes `shell` as idle.

A `NO CHANGES:` mark ([`cleanup.md`](cleanup.md), "Nothing to merge") says the work is over too (BTN-637): `Unchanged.follow` does not wait for `shell` and checks the folder. A clean one moves the task to Done; commits or uncommitted changes wait for the session as before — the mark is not remembered, and the session is told once its command ends or counts as hung. Without a merge, a Done or a mark, `shell` holds for the hour.

## A stop and the background commands

`claude stop` ends the session's process but not its background commands: on Windows (CLI 2.1.302) the `bash.exe` of a `run_in_background` command outlived it and held the worktree. So `ClaudeCli.stop` takes the session's process tree (`descendantsOf`, `src/claude/tree.ts`) and kills what is still alive once the session is gone (`killLeftovers`).

- **The listing.** `ps` before the stop, since an orphan there no longer leads back to its dead parent; on Windows `Get-CimInstance Win32_Process` alongside the stop, since it takes 1–2 s and Windows keeps an orphan's `ParentProcessId`.
- **The kill** takes only live pids, all at once: a `taskkill` costs ~0.5 s even on a dead one, and most exit with the session.
- **A listing that fails** or outruns its 15 s limit logs `sessions: listing the processes under pid … timed out|failed after … ms` (BTN-924: an empty tree in silence once left the folder held after Done). On Windows a failed first listing is taken again once the session's process has exited (`leftoversAfterStop`: orphans still name the dead parent, a creation-time filter keeps a reused pid's processes out); when that fails too, `sessions: <session> stopped, but its process tree could not be listed` says what may still hold the folder. The stop goes on either way. The 15 s stays: the listing takes 0.4 s idle and up to 1.8 s during a full `npm test`.
- **Orphans** of a session that died before the cleanup are found by their environment: [`cleanup.md`](cleanup.md), "Orphaned processes".
