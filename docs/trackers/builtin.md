# The built-in tracker (BTN-767, `src/builtin/`)

Even Keel's own tasks, in its state database (step 30, `docs/storage.md`): a project with `tracker: builtin` needs no account, profile or key. The adapter `builtin` (`adapter.ts`) is an own adapter ([`layer.md`](layer.md#terms)), so the wizard's tracker list, the profile kinds and the "no profile" log leave it out; `attachBuiltin(db)` hands it the database at the service's start. Its status moves are fixed (`fixedMoves`): a start goes to In Progress, a pull request to In Review, a merge to Done, whatever the project's or a profile's moves say.

Its copy into another tracker and the import into it are in [`copy.md`](copy.md) and [`import.md`](import.md).

## The model

- **Statuses** (`model.ts`) are fixed: Backlog (`UnStarted`), Todo (`ToDo`), In Progress and In Review (`Active`), Done (`Won`), Canceled and Duplicate (`Lost`).
- **Priorities** are `none`, `low`, `medium`, `high`, `urgent`.
- **Labels** are a project's list, each with a color picked by its name; `Question`, `Bug` and `Rework` are offered everywhere.
- **Milestones** are a project's list with an optional date, ordered by date, the undated after, then by name with numbers as numbers (v0.10 after v0.9).
- **A task** (`store.ts`, `BuiltinStore`) is named by its project's GUID and its number; the number is one past the last of every project of the same key, so `<KEY>-<N>` stays one task (`BuiltinNames` in `source.ts` maps both ways).
- **A parent** is of the same project, any depth, a cycle refused (`builtin.parentCycle`).
- **Links** are `blocks` and `relates`, also between projects of the built-in tracker, never to another tracker's task.
- **Comments** carry an author: `person`, `agent` or `service` (Even Keel's own), and an agent's comment its model (`<Provider> | <model>`, step 31; filled by the tasks server from the live session of the task).
- **Deleting a task** drops its labels, links and comments and frees its subtasks; an agent never deletes.

Not served: time logging and a closing reference (`logTime`, `closingRef` in [`layer.md`](layer.md)).

## No false conflicts

- An edit of a short field (title, status, priority, milestone, parent) carries the value its editor saw and the new one; it is refused (`builtin.conflict` with the current value) only when the field holds neither.
- The card's description editor edits the description the same way (BTN-772, `field: 'description'`, compared as is, the revision grown), so a change of another field meanwhile is no conflict.
- Labels and links are added and removed one by one, so nobody's addition is lost.
- The description has its own revision, grown only by a change of the description: a whole replacement names the revision it started from (`builtin.descriptionConflict`); a patch `old → new` needs none, but `old` must be found exactly once (`builtin.patchMissing`).
- The task's `version` grows on every change, for a poll to compare; it refuses nothing.

## The page's commands

The page reaches the tracker only through `builtin/*` POST commands (`routes.ts` over `BuiltinControl` of `control.ts`). Each answers with the task as the page shows it, every task named by its id, and refreshes the chain's read of the project; a refusal is a `builtin.*` notice.

- `create`;
- `edit` (`field`, `from`, `to`; a parent by its id, the description as its whole text);
- `description` (`text`, `rev`) and `patch` (`old`, `new`);
- `labels` (`add`, `remove`; a new name creates the label);
- `milestone` (`name`, `date`; created or redated);
- `relate`/`unrelate` (`other`, `kind`);
- `comment` (`text`, as `person`) and `uncomment` (`comment`);
- `delete`;
- `search` (`text`, `project` or `null` for every built-in project) finds tasks by a key or a word of the title, for the card's link and parent fields.

### Refusals of the card's edits (BTN-771)

- a parent that is the task itself (`builtin.selfParent`) or its descendant (`builtin.parentCycle`);
- a link that already exists (`builtin.linkExists`);
- a `blocks` that would close a loop through other tasks (`builtin.blockLoop`, `closesLoop` in `links.ts`);
- a blocker in a later milestone than the task it holds (`builtin.blockerLater`, `laterBlocker`: the chain could not order them, `docs/chain/entry.md`);
- deleting the chain's current task or one with a live session (`builtin.removeBusy`, the service's `busy` hook in `src/service/hosting.ts`).

The page checks the same before it asks (`web/src/pages/cardEdit.ts`); the service decides.

### The card

The card (`TrackerCard.edit`, `CardEdit` in `src/tracker/card.ts`) carries what the editing needs, and only this adapter gives it: the fixed statuses, the project's and the built-in labels, the project's component names, the ancestors and the subtasks. The page's side is in `docs/web/project-page.md`.

### The estimate from the card (BTN-1288)

`builtin/estimate` (`task`, `minutes` or `null`) sets it as a session's `estimate` does (`BuiltinStore.setEstimate`, into the history). The page reads "20", "1ч 20м", "1,5ч" (`estimateMinutes` in `web/src/pages/cardTime.ts`). Time spent is never written: it stays the sessions' active time.

## The task journal (BTN-774)

The comments are a journal, not a discussion: agent reports, Even Keel's `NO CHANGES:`, session questions with their answers, the person's notes.

- The source is marked `journal` (`TaskSource.journal`, `Tracker.journal`) and has no `commentsAfter`, so no comment ever answers a session. A session's question is posted with "answer in the session's chat" instead of "reply with a comment" (`questionComment(…, journal)`) and stored already read.
- An answer given in the page's chat to a question (`ask` set) is written into the journal as the person's note "Answer to the session" (`answerComment`, `BuiltinControl.answered`, `journalAnswer` in `src/service/hosting.ts`). Answers through Remote Control or a terminal are not.
- The person deletes only their own note: `uncomment` (`task`, `comment`) refuses any other with `builtin.noNote`.
- Each card comment carries `journal` (`id`, `by`, `model`), which only this adapter fills.

## The change history (BTN-1112)

Types and `groupChanges` are in `src/tracker/history.ts`, the rows in `builtin_history` (step 65 of `docs/storage.md`), written by `src/builtin/history-log.ts`.

- **What is recorded.** `BuiltinStore` records every field it changes in the same transaction as the change: creation, title, status, priority, milestone, parent, description, estimate, labels, `blocks`/`blockedBy`/`relates` on both sides, a subtask on its parent; a milestone's creation and date. A refused or idle write (the value already there, a retry) records nothing; comments are not in it, they are the journal.
- **A description** keeps only its line difference (`lineDiff`, `src/builtin/diff.ts`): two lines of context, a longer unchanged stretch only counted; above 4 million cells of the alignment it is every line removed and added.
- **The run** is Even Keel's (`task_runs`), so its change is recorded through `TaskEditor.noteRun`, by the tasks server's `task_update`/`tasks_create` and the page's `task/run`.
- **The author.** The source writes as Even Keel (`service`: the chain's moves, `NO CHANGES:`). The page's calls go through `TaskSource.asPerson` (`TrackerLink.page`) and `builtinControl` as `person`. A tasks server call runs inside `writingAs` (`src/tracker/author.ts`, an `AsyncLocalStorage`) as `agent` with its session's model, whatever wraps the editor.
- **Reading it.** The card gets `history`, oldest first; the page glues one author's changes within 5 minutes of the group's first into one entry, never across a comment, a field changed twice shown from the first value to the last and dropped when it came back (`docs/web/project-page.md`). `task_read(key, history: true)` adds `## History` in the same groups, a description as its counts of lines (`src/taskmcp/history.ts`); another tracker answers that it keeps the history itself.
- Imported changes (BTN-1079) keep their time and `author_name`.

## Components (BTN-1288)

`components.ts`, `builtin_components`, step 66 of `docs/storage.md`. A task has at most one; the name is unique in the project ignoring case, the description is Markdown. The chain never reads them: they sort tasks for a person and for "Lanes by component".

The page's routes:

- `builtin/components` (`project`) lists them by name with `open` and `total` task counts;
- `builtin/component` (`project`, `id` or none, `name`, `description`) creates or changes one and answers `{ id }`; refusals `builtin.emptyName`, `builtin.componentTaken`;
- `builtin/component/delete` (`project`, `id`, `to` — another component's id, or none for no component) moves every task of it, closed ones too, then deletes it; refused with `builtin.componentBusy` while one of them is the chain's current task or has a live session (the same `busy` hook as a task's deletion);
- the card's `edit` of `component` takes a name, and `create: true` makes a new one; without it an unknown name is `builtin.noComponent`.

Sessions set it through the tasks server's `component` (`TaskEditor.components: true`): only an existing name, an unknown one refused with the list, never created. The `chain:` line lists the project's components (`components: none` when it has none).

Every change of a task's component, and a component's creation, rename, description and deletion, goes into the change history; a task keeps its old component's name there after the deletion. The copy into another tracker gives a task the target's component of the same name where the target keeps components, and plans the rest as the loss `components`.

## Milestones (BTN-1287)

`milestones.ts`, `builtin_milestones`, step 67 of `docs/storage.md`. A milestone has a name (unique in the project ignoring case), a target date (`date`), a Markdown description and a status: `planned`, `active`, `completed` or `canceled`. The two last ones are closed and stamp `closed_at`, which a return to an open status clears.

**The status never reaches the chain**: it still decides by the milestone rules and the tasks' statuses, as on Huly. Closing a milestone with open tasks is allowed; the page warns with their keys.

The page's routes:

- `builtin/milestones` (`project`) lists every milestone with `open`, `total` and the keys of its open tasks (`openTasks`);
- `builtin/milestone/save` (`project`, `id` or none, `name`, `description`, `status`, `date` — ms of the UTC midnight or none) creates or changes one and answers `{ id }`; refusals `builtin.emptyName`, `builtin.milestoneTaken`;
- `builtin/milestone/delete` (`project`, `id`, `to` — another milestone's id, or none for no milestone) moves its tasks, then deletes it;
- the older `builtin/milestone` (`name`, `date`) still creates or redates one from the chain rules' milestone fields.

A deletion is refused:

- with `builtin.milestoneClosedTasks` while the milestone has a closed task: those keep the milestone they were done in, so cancel it instead;
- with `builtin.milestoneBusy` while one of its tasks is the chain's current one or has a live session;
- with `builtin.milestoneRequired` when it is the only name of the project's `chain.requiredMilestones`: without it the chain would take every milestone.

**A rename or a deletion edits the project's own settings in the same write**: the name is replaced (or dropped) in its `chain.requiredMilestones`, `chain.excludedMilestones` and `milestoneOrder` (`withRenamedMilestone` in `src/config-form.ts`, written by `ConfigStore.renameMilestone`, queued like every config write); shared rules are left alone. A refusal there rolls the milestone write back.

Every change of a milestone (creation, name, description as its line difference, status, date, deletion) goes into the change history.

## Attachments (BTN-773, `files.ts`, `BuiltinFiles`)

### The store

A record in `builtin_files` (step 32) and the bytes in `state/even-keel/files/<sha256>`: one copy for the same bytes, unique per task. The bytes are written before the record (via a `.upload-*.tmp` rename). The service sweeps, at start and hourly, bytes no record points at and half-written uploads older than a day, so a description edit undone within the day shows its picture again.

### Upload and deletion

- The page uploads the raw body to `POST /api/builtin/attach?task=&name=` (the type from `content-type`) and gets `{ file, name, type, size, url }`.
- The body is read up to the setting `attachmentLimit` (MB, live); past it `builtin.fileTooLarge`. The page refuses a bigger file before sending it (`useUploads`). The service refuses a `content-length` past the limit unread; a body without one that passes it midway is read off to its end first, since a refusal amid the body leaves the browser waiting forever (BTN-1534).
- `builtin/detach` (`task`, `file` — the record's id) deletes the record (`builtin.noFile` when there is none).

### Serving

The file route serves the bytes by hash whether or not a record is left, typed by their first 4 KB only (`sniffedType`):

- a raster picture as itself;
- an SVG — the root `<svg>` after a byte order mark, an XML declaration, comments and a doctype — as `image/svg+xml` (BTN-1449). `sendFile` (`src/server-response.ts`) serves any tracker's SVG inline under `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `nosniff`, so opened by its own address it runs no script and fetches nothing, while its SMIL and inline CSS `@keyframes` animate. The description's upload inserts an SVG as a picture (`fileMarkdown`);
- anything else as `application/octet-stream`, a sandboxed download: HTML never runs as the page.

The card's attachments carry `id`, the absolute `path` and `missing` when the record outlived its file (logged, shown as a "No file" tile).

### Sessions read copies

Sessions never read the store: one with the store in its reach could rewrite another project's bytes (BTN-1538). `task_read` lists copies ([`tasks-server.md`](tasks-server.md#files-in-task_read)), and the brief of a chain session ends with the same list (`PROMPTS[lang].files`, `withBrief` in `src/chain/relay.ts`), whose store paths the machine swaps for copies it makes in the task's folder before the launch and each handoff (`withBriefCopies`, the parents' files under their own keys). A file the machine cannot copy, such as the hub's on a machine elsewhere, keeps its store path in the brief; `task_read` carries those bytes over the link as any tracker's.

## Sessions

Sessions edit its tasks through Even Keel's own tasks server ([`tasks-server.md`](tasks-server.md)): the adapter's `mcpServer` is `tasks`, so the brief follows the auto rule of [`layer.md`](layer.md#the-brief). Its writes are `builtinEditor` (`editor.ts`) over the store: a short field set against the value it holds now (never a false conflict), a whole description by its revision, patches through `BuiltinStore.rewriteDescription` in one transaction, comments as `agent` with the session's model.

## Tally

Tally reads the tasks from the state database each run and counts a rework by `Rework` as well as `Переделка`, on `/stats` and in its own views (`docs/tally/cost.md`, "Tasks from the trackers").
