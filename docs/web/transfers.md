# Page: moving a project between trackers

The two transfer windows of a project's Tracker tab — off the built-in tracker (the export) and onto it (the import) — and the "Transfers" reports. The copy itself, its stages, the check and the switch are `docs/trackers/copy.md` (export) and `docs/trackers/import.md` (import); the settings panel around them is `docs/web/project-settings.md`.

## Why a window and not the tracker field

Once the chain has launched a task of a project, the page does not switch its tracker or tracker project (`docs/web/project-settings.md`, "Locked tracker"). A project with tasks in the built-in tracker cannot leave it through the field either (`config.builtinLocked`, BTN-769), and a project with tasks of another tracker is not offered the built-in one. These windows are the way: they copy the tasks first and switch the project only on "Switch".

Both windows are of the `add-package` dialog's classes, laid out by one shared mockup (BTN-1290), with texts in `t.transfer`. Their head is the title with a "?" holding what the copy does and does not do (`t.transfer.leadTip`), under it one short line (`lead`). On a phone the foot's buttons stand one under another, the primary on top.

## Off the built-in tracker

"Move to another tracker" at the right of the Tracker card's head (BTN-1075, `BuiltinExport.tsx`, `builtinExport.css`), shown while the saved tracker is the built-in one and the project has tasks. The window reads `builtin/export/state` first (the loader), then stands in one of four phases.

### Pick

- The tracker block (`TrackerFields`, profiles of every tracker but the built-in one) and, where the tracker's ids do not carry their own (`keyTyped`), the project key (`keyOfTyped`), passed as the block's `children` so it takes the next cell of the block's grid; Linear's team and project and the key fill two rows with no blank cell (EKR-147).
- Once the fields are filled the window asks `builtin/export/plan` (debounced 400 ms), and the strip under the tracker project says only whether it is reachable or why not.
- The switch "Move the closed tasks too" (BTN-1289, its "?" `t.transfer.closedTasksHint`: the closed tasks are created and closed today, their dates are the journal's first entry, subscribers get a notification each, GitHub's limits make a long move take hours) is off by default, sent as `closed` and locked once a copy started (the lead then `leadAll`). On, the plan counts the closed tasks in its tiles and statuses.
- The switch "Change history as one comment" (its "?" `t.transfer.historySummaryHint`) is off by default, sent as `history` and locked once a copy started; on, it adds Even Keel's summary comment to a task. The losses box lists the tasks with a history as "Change history".

### The plan

`TransferPlan.tsx`.

- **"What will move"**: tiles of the plan's `counts` — tasks, comments, attachments, links (the label's tip splits them into "blocks", "related to" and subtasks), milestones, labels. The mockup's "Changes" tile is not shown: no target takes the history as its own (BTN-1112).
- **"Statuses"** (its "?" gives the rule of `statusFor`): a table "Here | Tasks | In <tracker>" of the plan's `statuses`, each with the category's dot (`StatusDot.tsx`), "Default" where the tracker has no status of the category.
- **"What will not move"**: the plan's losses by kind (its tip says why), the names and "N tasks" (the ids in a tip); for labels and milestones "Check again" asks the plan anew after they are made in the tracker.
- The primary button is "Move", or "Move without them" with losses.
- Refusals: a refused key (`switch.samePrefix`, `switch.prefixTaken`) is the key field's strip, any other refusal of the plan the tracker project's strip, a refused start or switch the dialog's band.

### Running and stopped

- The fields are locked; a meter shows the step the copy is at (BTN-1194, `meterOf` in `exportMeter.ts`). The copy passes every task through a step before the next one starts, so the meter names the first step not every task passed — "Creating tasks", "Links", "Attachments", "Comments", "Marking old tasks", its tip saying "Step N of 5" and what the step does — with that step's count of `total`, the bar filling again on each step; "Moved · M of M" once every task is marked.
- The window is polled every 1.5 s; it may be closed, the copy goes on in the service and the window reopens on it.
- Stopped (a failed write, or a run lost to a restart): the meter where it stopped, the band with the reason (red) or a warning, the primary "Continue" (`builtin/export/start` again).

### Finished

- The lead says every task is there; the copy's check (BTN-1291, `TransferCheckTable` in `TransferPlan.tsx`, `docs/trackers/copy.md`, "The check and the report") is a table "Here | In <tracker>", a row a kind, a row that did not match red with "!" and the short tasks (the ids in a tip).
- A mismatch adds the band `switch.mismatch`'s text and the foot "Repeat" (`builtin/export/retry`) and "Switch without them" (`anyway`) beside the primary; a check that failed is the band `export.checkFailed` with "Repeat".
- The primary "Switch to <tracker>" sends `builtin/export/switch`, and the window closes on its answer.
- A switch refused while the chain works on the project (`switch.held`) is the band with its items as a list and, when the chain runs (`switch.chainRuns`), "Stop the chain" (`chain/dequeue` if queued, then `chain/stop`). In an item that names tasks — the held one, released ones, open pull requests — each id is a link in place to its card (`?task=`), where its session is answered or the task closed, so the band keeps one button (BTN-1459, `heldTasksOf` and `taskParts` in `heldTasks.ts`).
- After the switch a card's link to a moved task shows "Moved to <key>" under it (`RefLink` in `CardLinks.tsx`, `docs/trackers/copy.md`, "The old task's links").

## Onto the built-in tracker

The import window (BTN-1406, `BuiltinImport.tsx`, texts `t.transfer.imports`): its button "Move to the built-in tracker" takes the same place for any saved tracker but the built-in one (`BuiltinImportButton`). For a tracker whose `TrackerChoice.imports` is unset (its adapter gives no `importSource` — Jira, GitLab, Forgejo for now) the button is quiet (`aria-disabled`) and its tip says the import is not built yet.

It is the export's window the other way: no tracker block (the source is the project's tracker); the lead and the title's "?" say the tasks come with their whole history under the same numbers and the project moves only on "Switch". It reads `builtin/import/state` and stands in a phase of `importPhaseOf` (`importPhase.ts`). Every read of the window goes through `read`, off the page's loader (BTN-1452).

### Reading the plan

- `builtin/import/plan` reads the source (`ImportState.planning`, `docs/trackers/import.md`, "The plan's read"). Meanwhile the window reads the state every 1.5 s and shows the meter "Read N of M" (a running bar until the task list came) with a note to keep the window open.
- Closing it — ×, Cancel, Esc, another page, the tab gone — sends `builtin/import/planStop` (keepalive) and the service stops the read, so the next opening reads anew (BTN-1453).
- A refused read (the band) has the primary "Read again" in place of "Move" (BTN-1460), which asks the plan anew with its meter. The service asks a transient refusal again by itself first (`docs/trackers/import.md`, "A transient refusal"); `?import=busy` of `dev:fake` refuses the first read as `import.planBusy`.

### The plan

- The tiles with "Changes" and "Components" added (`TransferMoves` shows them when the counts have them).
- Statuses "In <tracker> | Tasks | Becomes" (`TransferStatuses` with `direction="import"`).
- The losses with the import's own names and tips for links and parents in other projects (their count only, the ids being other projects') and the change history.
- **"Authors"** (BTN-1416, `ImportAuthors.tsx`, picks in `authorPicks.ts`): a table "Author | Comments | Changes | Becomes" of the plan's `authors`, the most first, a `Select` a row of "Agent", "You" and "Under their name" (not offered to an author the tracker gives no name: it would be the user), each starting at the source's marking. A pick shows at once and asks the plan again with every author as `authors`, only the last pick's answer taken; on a phone the counts stand under the name.
- "Move" sends `builtin/import/start` with the same `authors` (only the first start: "Continue" and "Repeat" send none, the service keeps them). The meter then has the copy's note (`t.transfer.running`): the window may be closed.

### Running, finished, switching

- The meter of four steps (`IMPORT_STEPS` — tasks, links, attachments, the journal — through `meterOf(progress, total, steps)`), "Continue" after a stop.
- Finished: the check "In <tracker> | Here", "Repeat" (`start` again) and "Switch without them" on a mismatch, the primary "Switch to the built-in tracker" (`builtin/import/switch`, `anyway` past a mismatch).
- Switching (BTN-1432, while `ImportState.switching` is set): one meter of the switch's stage — "Last pass", "Check", "Switching", each with its tip — and its count of tasks (none for the move itself), a note that the window may be closed and only Close. The window reads the state every 1.5 s while it goes, also when reopened mid-switch, and closes itself when a switch it watched leaves the project on the built-in tracker.
- Refusals are the export's `Refusal`, "Stop the chain" included.

## Transfers

- Under the tracker block a "Transfers" section (`TransferReports.tsx`, hidden with no report) lists the project's reports (`builtin/transfers`) newest first: the direction and tracker, the switch's date, the tasks and "check matched / did not match".
- A row opens the report read-only (`builtin/transfer`) in the transfer window: the plan's tiles, statuses and losses and the check as they were at the switch, plus what was switched without. An import's report lists as "From <tracker>" and opens as "Transfer from <tracker>"; a key that stays the same is not said to have changed (`reportWhen`).
- The event log's place of `eventLog.transferMatched`/`transferMismatched` opens the Tracker tab with that report (`openReport`/`usePendingReport` in `transferStore.ts`).
