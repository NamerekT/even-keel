# The built-in tracker: reading a history and importing it

Huly, GitHub and Linear have an import into the built-in tracker; Jira, GitLab and Forgejo have none.

## Reading a project's whole history (BTN-1402)

The read side of the import (`src/tracker/import.ts`). An adapter that has an import gives `TaskSource.importSource(project)`, an `ImportSource` that only reads:

- `tasks()` — every task, closed, cancelled and duplicates too, by number, with the status and its category, priority, milestone, component, labels, estimate in minutes, parent, `blocks`, `blockedBy` (a pair of the project's tasks stands on both sides), related, `createdAt`, `createdBy` and `closedAt`;
- `comments(ref)` — the journal oldest first, a reply with `replyTo` its comment;
- `files(ref)` — the task's attachments, its comments' and the pictures of its texts, each once by `key`;
- `changes(ref)` — absent where the tracker gives no change log (then the plan names it among what does not move);
- `milestones()` — every milestone of the project, those without tasks too (BTN-1436): name, target date, status (`planned`/`active`/`completed`/`canceled`), Markdown description and `closedAt`. A field the tracker does not keep is empty and named in `milestoneGaps`.

An author is `agent`, `user` or `person` with the tracker's name, no model. A link carries `foreign` for a task of another project: it is not imported, the plan counts it. A picture inside a description or a comment stands in the Markdown at its `images[].ref`, to be rewritten to its new attachment by [the run](#the-run).

### Huly

`hulyImport`, `src/huly/import.ts`.

- **The read.** The project is read once on the first call: its issues, statuses, milestones and components (closed ones too), labels, the identifiers of linked issues of other projects and the activity's change records (`activity:class:DocUpdateMessage` of each issue, `$in` lists of 200). Descriptions are fetched as markup, eight at a time.
- **Texts.** `hulyText` (`import-text.ts`) turns markup into Markdown, each stored picture (`image` with `file-id`) as `huly-image:<blob>` and each reference — a mention of a person, a link to an issue — as its label in plain text. A colour mark that names no colour (`textColor` or `textStyle` with `color: null` or blank, which Huly's serializer writes as `<span style="color: null">`) is dropped and its text kept; a real colour stays (`withoutBlankColors`, `src/huly/colors.ts`, BTN-1450).
- **The change log** gives title, status, priority, milestone, component, estimate (Huly keeps hours), parent, `blockedBy` and `relates`. Labels and descriptions have none (a removed label's name is gone with its reference). `closedAt` is the last change into the issue's current closed status.
- **Authors.** The agent is the person of the account Even Keel signs in with, the user the project's creator (`createdBy`), anyone else a person. Huly's time reports are not read (BTN-1079).
- **A milestone** gives its `targetDate` (0 — none), `status` (Planned, In progress, Completed, Canceled → `planned`, `active`, `completed`, `canceled`) and `description` — inline markup, or a reference to its collaborative document fetched as an issue's is — through `hulyText`. Huly keeps no closing time (`milestoneGaps: ['closedAt']`).
- **A missing file.** A file the storage does not have (a 404, the client's `NotFoundError` with an empty text, known by its `name`: `storageNotFound`) reads as gone (`read()` → `{ gone }`) and is not retried with a new storage connection. Any other storage failure throws and stops the import (BTN-1454: an attachment whose blob the storage had lost).

Never seen live: [unverified](../unverified/trackers.md#reading-a-huly-projects-whole-history-for-the-import-btn-1402).

### GitHub (BTN-1403)

`githubImport`, `src/github/import.ts`.

- **The read.** The repository's issues are read once on the first call, pages of 100 by creation time. `repository.issues` gives no pull requests, so they are never tasks.
- **Fields.** The status is GitHub's own (Open, Completed, Not planned, Duplicate); the priority that of a `priority: <level>` label, which stays out of the labels; parent, `blocks` and `blockedBy` (an issue of another repository `foreign`, its id `KEY-n` when a project has that repository, else `owner/name#n`). `closedAt` is GitHub's last closing. GitHub keeps no estimate, component, related tasks, threads or time reports: they are empty.
- **Uploads.** Every upload in a description or a comment (`github.com/user-attachments/…`, a picture or a file) is one of the task's files, keyed by the upload's id (a file link by itself), and stands in `images` at its own address, so the run points the link at the attachment; other addresses stay as they are.
  - A file is named by its link text or its HTML picture's `alt` (`uploadsIn`, `src/github/uploads.ts`, which the page's comment files read too), by the upload's id where GitHub wrote its own `alt="Image"` or `![image]` (BTN-1469).
  - It is downloaded through `readUpload` (`src/github/source.ts`), its type taken from the answer and the name given the type's extension when it has none (`withExtension`, `src/tracker/file-names.ts`). The source keeps each type it was served, so a later list of the task's files, the journal's, names a file the same.
  - When GitHub refuses the token (401, 403, 404, 410), the signed link is looked for in the description's `body_html`, then the comments'. An upload the token gets nothing of and no text links signed is gone; any other failure on the way stops the import (BTN-1458), while the page's `TaskSource.file` over the same read logs it and gives no file.
- **Comments** are read a task at a time, the last task's kept for its files.
- **The change log** is the timeline's closed, reopened, renamed, milestoned, labeled, parent and blocking events, replayed from an open issue with no labels or milestone; a priority label's event is a priority change. A blocking link has an event on both issues (BTN-1468): `BlockedByAdded`/`BlockedByRemovedEvent` with `blockingIssue` is a `blockedBy` change, `BlockingAdded`/`BlockingRemovedEvent` with `blockedIssue` a `blocks` change, as the built-in tracker logs each side under its own name. An event whose other issue GitHub gives as null (deleted, out of the token's reach) gives none.
- **Authors.** The agent is the token's account, the user the repository's owner when it is a person (an organisation's repository has none), anyone else a person, all under their login.
- **Milestones** are `repository.milestones(states: [OPEN, CLOSED])`, read on their own call: `dueOn`, `description`, `closedAt`, an open one `planned` and a closed one `completed`.

Seen live on a sandbox repository ([verified](../verified/trackers.md)); a fine-grained token and an owner other than the token's account are left assumed.

### Linear (BTN-1404)

`linearImport`, `src/linear/import.ts`.

- **The read.** The issues of the project's team, narrowed to its Linear project where the place names one, are read once on the first call, pages of 25 (a query's complexity stays under Linear's 10000) with `includeArchived`, so closed issues Linear archived come too. An issue in the trash (`trashed`) is deleted, and neither it nor a link to it moves.
- **Fields.** The status is the team's state with its category (`linearStatus`), the priority Linear's, the milestone the project milestone's name, the estimate the team's points as minutes (`linearMinutes`; a team that estimates nothing gives none). Parent, `blocks`/`blockedBy` come from the `blocks` relations of both ends, `related` from `related` and `duplicate` ones; a link to an issue the read did not give is `foreign`. `closedAt` is `completedAt` for a completed state, `canceledAt` for a cancelled or duplicate one. Linear has no components or time reports: empty.
- **Uploads.** Every `uploads.linear.app` link in a description or a comment, and every attachment that is such an upload, is one of the task's files keyed by its link and stands in `images` at its own address. An attachment that links elsewhere (a pull request, a thread) is no file and stays behind. A file is downloaded with the key, as `TaskSource.file` does (`fetchUpload`), its type from the answer; a 404 or 410 is gone, any other status stops the import (BTN-1458), where the page's `file` gives no file.
- **Comments**, archived ones too, are read a task at a time, the last task's kept for its files; a reply's `replyTo` is its thread's comment (`parent`).
- **The change log** is the issue's `history`: each entry gives a change of every field it carries — status (an entry with no `fromState`, the creation, gives none), title, priority, estimate, parent, each label added or removed. The milestone and the relations have no change read.
- **Authors.** The agent is the key's account (`viewer`), the user the Linear project's creator (a whole team has none), anyone else a person, an integration's comment a person under its bot's name.
- **Milestones** are the `projectMilestones` of the team's projects (the place's Linear project alone where it names one), a name of two projects once: `targetDate` and `description`. Linear's have no status or closing, so each is `planned` (`milestoneGaps: ['status', 'closedAt']`).

Seen live on a sandbox project ([verified](../verified/trackers.md)); an integration's comment and a Linear project made by another member are left assumed.

### A file's read (BTN-1458)

`ImportFile.read` is one contract for every adapter, a new tracker's import too:

- the bytes;
- `{ gone: <why> }` only when the tracker surely has no file: HTTP 404 or 410 (`fileGone`), the tracker's own "not found" (Huly's `NotFoundError`), or GitHub's upload the token gets nothing of and no text links signed;
- anything else throws and stops the import, and a repeat goes on from this file: the network, a timeout, 429, 5xx, and no access (401, 403) too, which a person fixes rather than loses the file to.

The adapter writes no log line of a gone file; the import writes it with the `gone` reason. The page's `TaskSource.file` keeps its own leniency (no file on any failure), so an adapter reads a file for the import through its own strict read, not through `file`. `src/tracker/import-files.test.ts` holds every adapter to the contract on a stand-in `fetch` or client — served, 404, 410, 401, 403, 429, 500, the network: a new import adapter adds its row to `ADAPTERS` there.

Never seen live for GitHub and Linear: [unverified](../unverified/trackers.md#a-deleted-upload-of-github-or-linear-in-the-import-btn-1458).

### A transient refusal (BTN-1460)

`ImportSource.transient`, `retryingSource` in `src/tracker/import-retry.ts`. The adapter says which refusals pass by themselves; without `transient` nothing is asked again.

- `BuiltinImports` opens every source through `retryingSource`, so the plan's read, the run, its check and the switch's pass ask each such read again — `tasks`, `milestones`, `comments`, `files`, `changes` and a file's `read` — after pauses of 5, 15 and 40 s (`RETRY_PAUSES_MS`, the deps' `retryPausesMs` in tests). Each new ask is a log line `import: the tracker refused <what>, asking again in N s: <reason>`.
- The last refusal becomes a `SourceBusy` (its `tries`, the refusal its cause). The plan's read is refused with `import.planBusy`: the tracker was overloaded, nothing is written, press "Read again"; the refusal itself is only in the log. A run's or a check's stop gets `transfer.busy` under its `transfer.stop` (`stopExtras`).
- Huly's (`hulyTransient`, `src/huly/transient.ts`): the SQL server's shared memory pool full ("memory budget exceeded", 128 MB on the self-hosted server, seen on a plan's read and on eight parallel file reads), `platform:status:ConnectionClosed`, the network (`NetworkError`, socket codes, "fetch failed"), a storage answer of 429 or 5xx — its `StorageError` keeps only the answer's text, so it is known by its words.
- GitHub and Linear give none yet.

## The import into the built-in tracker (BTN-1405)

The write side: `BuiltinImports` in `src/builtin/import.ts` over `runImport` in `import-run.ts`; the page's window (BTN-1406) is in `docs/web/transfers.md`.

- An adapter that has an import also sets `TrackerAdapter.imports`, passed to the page as `TrackerChoice.imports` (`trackerChoices`, `src/config-form.ts`). Without it the window's button is disabled, its tip saying the import comes in a later release.
- The project's tracker is opened by `connectImportSource` (`src/tracker/import-source.ts`) on the profile the project runs on, at its key and place. An adapter without `importSource` is refused with `import.none`, a project already on the built-in tracker with `import.builtin`.

Routes, all with `project`:

- `builtin/import/plan`;
- `builtin/import/start` (`authors` — the plan's choices, `[{ kind, name, as }]`, `kind`/`as` in `agent`/`user`/`person`);
- `builtin/import/state`;
- `builtin/import/planStop` (below, "The plan's read");
- `builtin/import/switch` (`anyway` — past a check that did not match; answers `key` and `renamed`).

### The plan

`importPlan`, `src/tracker/import-plan.ts`, pure; the page imports it. `ImportPlan` is an `ExportPlan` ([`copy.md`](copy.md#the-plan-exportplan)) with `components` and `changes` among the counts, and `authors`: every author of the comments, the changes and the tasks' creation, with their counts and `as`, by default the adapter's marking. The tasks an author created are its `tasks`, not among its `changes`, which count the change log as the plan's `changes` do (BTN-1429).

Every task moves, closed ones too; a status becomes the built-in one of its category (`importedStatus`). The milestones' count takes the source's milestones with the tasks' (BTN-1436). What stays behind:

- `links` and `parent` to tasks of other projects;
- `history` where the source gives no change log;
- `timeReports` where the tracker keeps them (`ImportSource.timeReports`);
- `milestones` with the fields of `milestoneGaps` as its names (the window names them by `milestoneFields`).

A project the built-in tracker already has tasks of, and no import wrote, is refused with `import.hadBuiltin`: it was on the built-in tracker, and a way back is not built yet.

### The plan's read (BTN-1452)

`PlanReads` in `src/builtin/import-reading.ts`.

- **What it reads.** Every task's comments, change log and files, to count them (`countTasks`), `ImportSource.parallel` tasks at once: Huly 8, the others `PLAN_PARALLEL`, 4, which GitHub's secondary limits and Linear's complexity stand. A task's three reads go in one tick, so the adapters' last-thread caches still serve them from one read. The first failure stops it.
- **Kept.** The read is made once a project and kept 30 min after its last ask (`PLAN_KEEP_MS`). A second `builtin/import/plan` while it goes waits for it, an author's pick counts again from it, and `start` takes it (`take`) when it is of the tracker the start opens; another tracker, or none kept, is read through the start's own source. A read that failed is not kept.
- **Stopped by the window (BTN-1453).** The window closed while its read goes — ×, Cancel, Esc, another page, the tab gone (`pagehide`, sent `keepalive`) — sends `builtin/import/planStop`. `PlanReads.stop` drops the read and aborts its signal, so the tracker is asked nothing more (`abortableSource` under `retryingSource`, whose pause between tries ends at once); a call already sent is answered and thrown away, the source is closed, whoever else waits on the read gets `import.planStopped` with "Read again", and the next window reads anew. A read that is through stays kept, and the start's own read (`take`) has no stop: after "Move" the window may be closed.
- **Progress.** While a read goes, `ImportState.planning` is `{ done, total }` (`total` 0 until the task list came). The log has a line at its start and one at its end with the tasks and the seconds.

The last pass reads the source as before; both checks read it as the plan does (`readTasks`, "The check" below).

### The run

The run goes by stages as the copy out does, kept a task a row in `tracker_import_tasks` (`ImportRecords`, `import-store.ts`) under a `tracker_imports` header with the source, the authors, the plan and the check, so a repeat of `start` goes on from where a failure stopped. An import begun from another tracker with tasks written is refused with `import.otherTracker`.

1. `created` — the components first; then the source's milestones with their fields (`importMilestone`, `milestones.ts`, BTN-1436: history at the import's time by the service, one already there left alone, a closed one with no `closedAt` taking the last `closedAt` of its tasks, else the import's time); then each task under its own number (`NewBuiltinTask.number`; the counter goes on from the greatest), parents first (`importOrder`), with its creation time and author. A task already there by number is not made twice.
2. `linked` — blocks and relations between the project's tasks, written as they are (no loop or milestone check, no history).
3. `attached` — the files by their `key` (`BuiltinFiles.add`), the sha of each kept in the row; the description's pictures (`images[].ref`) are rewritten to `/api/tasks/<KEY>-<n>/files/<sha>`.
4. `journaled` — the comments in time order, a reply flat in its place; a comment's other files as links under it.
5. `done` — the change log by its authors (`logTask` with the name). A one-value field's change with no `from` is given the `to` of that field's change before it (`withBefore`, BTN-1434: Huly gives no previous status, title or estimate), so only a field's first change may start empty. Without a change log, a closed task gets one status row at `closedAt`.

Task numbers in the texts are left as they are; a mention of a person is already their name in text (the adapter's doing).

### The authors (`importedAuthor`)

- `agent` is written as the agent with no model;
- `user` as the person of the page with no name;
- `person` as a person under the tracker's name — `builtin_comments.author_name` and `builtin_history.author_name`; the task's card and the journal show that name.

A comment under another person's name cannot be deleted from the page (`uncomment` refuses it).

### The check

`checkImport`, `src/tracker/transfer-check.ts`, counts after each run: tasks, comments, the change log (only where the source gives one), files, links with the parent, milestones, labels, components — a link only between two tasks of the project.

- **The read.** It reads the tasks as the plan does (BTN-1461, `readTasks` in `import-plan.ts`): `ImportSource.parallel` tasks at once, a task's source counts and its built-in copy asked together, its three source reads in one tick, the rows added up in the source's order once every task is read, the first failure stopping it.
- **Progress.** While the check after a run goes, the run is still `running` and `ImportState.checking` is `{ done, total }`. The window shows it as "Check N of M" in place of the run's meter, full by then, with the tasks moved in the note under it; the switch's check has its own step in `switching`.
- **Milestones.** A milestone of the source counts as there only when the built-in one of its name has its date and status (a field of `milestoneGaps` is not compared) and every task of it is in it (BTN-1436).
- **Kept** in `tracker_imports.checked`. A check that cannot read the source keeps the import finished with `import.checkFailed`.
- **A gone file.** An attachment whose bytes the source does not have (`ImportFile.read()` → `{ gone }`) is passed over with a log line the import writes, not the adapter (`<ID>: the attachment <name> has no file and is not imported: <gone>`, BTN-1458). Its key is kept in the row's `files` as `GONE` (an empty sha256), so a repeat and the last pass do not read it again (BTN-1454). The check leaves it out of the files' source side and names it in the files row's `gone` (`{ task, name }`), which the window shows as a line under the table with the files in its tip.
- **One key, one file.** A file is its `key` within the task: two attachments of one key are one file attached twice (seen on Huly: one blob attached twice to a task), which the run moves once. So the plan and the check count a task's files once a key too (`distinctFiles`, BTN-1457); a row's `seen` counted so carries `filesByKey: true`, and the switch's check reads a task whose `seen` lacks it again.
- A failed read of an attachment stops the import at the stage `attach` with the file (below).

### Where a transfer stopped (BTN-1455)

`src/tracker/transfer-stop.ts`. Each stage of `runImport` and `runExport` runs inside `atStage(place, body)`: a failure becomes a `TransferStop` with the place. A narrower place inside keeps its own. The place is:

- the stage: `read`, `components`, `milestones`, `create`, `links`, `attach`, `journal`, `history`, `fields` of the last pass, `mark` of the copy, `check`;
- the task's id, or `null` for a stage of the whole project;
- what it was on: a file, comment n of m, a milestone, a component.

`stopExtras` turns it into the notice's extras:

- the cause `transfer.stop` (`{ stage, task, item, url }`, `url` the task in its tracker by `OpenedImportSource.url`, the profile's `issueUrl` template);
- the detail — the underlying error by `errorText`, never blank: an error without a message is named by its class with its HTTP status, Huly's `status.code` or its `code` (`StorageError (HTTP 503)`), an empty non-error is "an empty error".

A failure outside the stages gets the cause `transfer.reason` ("The reason: …"). So `import.failed`, `import.checkFailed`, `export.failed`, `export.checkFailed` and their event lines read "… stopped. The project stays on …. On ABC-3, while moving its attachments (the file log.txt): StorageError (HTTP 503)". The window (`TransferFailure` in `web/src/pages/TransferPlan.tsx`) turns the task's id into a link when the cause has a `url`. The service log gets the same English line and, on the next, the stack of the deepest error (`stackOf`). The switch's last pass refuses the same way with `import.passFailed` (its cause and detail as above).

The texts are in `src/notice/en-transfer.ts` and `web/src/i18n/notices-transfer-ru.ts`. `error-text.ts` holds `errorText` free of `node:*` (the page's fakes reach it through `import-plan.ts`); `link.ts` re-exports it.

Seen live once, on Linear ([verified](../verified/trackers.md)); Huly and the copy: [unverified](../unverified/trackers.md#where-a-live-import-or-copy-stopped-btn-1455).

### The switch

**Refusals.** The switch refuses:

- while the import runs (`import.running`; a `start` while the switch goes is refused the same way);
- before it finished (`import.notFinished`);
- without a check or past one that did not match (`switch.noCheck`, `switch.mismatch`);
- while the chain holds the project (`switchHolds`, as the copy's switch, asked before the last pass and again at the move, since the chain may start meanwhile). A running chain and the task it holds hold the switch.

**Released and shelved tasks and open pull requests** do not hold it when their ids stay the same (BTN-1459, `switchHolds`' `kept`; known only after the last pass read the source, so a task whose id changes holds it then).

- The task stays in `released`, `shelved` or `reviews` as it was; its branch, worktree, launch log and chat stay right, and the next read of its status goes to the built-in tracker. Its Done there is the usual cleanup (`docs/chain/entry.md`, "Released tasks"); a merged pull request moves it to Done there through `moveStatus`.
- Its session is not touched. A session's tasks server finds the tracker on every call by the project's id (`ctx.linkOf` in `src/service/account-packages.ts`), and the switch's config change retires the old tracker's link and starts the built-in one's under the same key prefix, so a resting session's `task_read` and `task_comment` go to the built-in tracker.

#### The last pass (BTN-1432)

It takes what changed in the source since the check:

- every milestone of the source gets its fields again;
- new tasks go through every stage;
- a task through gets the source's fields, labels and parent, new links, files, comments past those written and changes past those written; a link removed in the source after the import is not removed.

A task through is passed over (`unchanged` in `import-run.ts`) when its `ImportTask.modifiedAt` — the tracker's time of its last change — equals the one its row's `seen` (step 74) kept at the last check:

- Huly's is the greatest of the issue's `modifiedOn`, its comments' and replies' times (`createdOn`, `modifiedOn`, `lastReply`), its and its comments' attachments' and its activity's `DocUpdateMessage`s, all read in bulk with the project. Huly's import keeps the last task's thread, so a task's comments and files are one read;
- GitHub's is the issue's `updatedAt`;
- Linear's is `null` (never seen whether a comment or a file moves `updatedAt`), and a `null` task is read every time.

Links are written from both sides of a task (`blocks`, `blockedBy`, `relates`), so a changed task brings a link even when its partner is passed over.

#### What the switch writes

- The check is counted again: a task unchanged since takes the source's counts its row kept (`seen`), the built-in side is always read; the regular check and "Repeat" count the source afresh and keep what they saw. It is frozen into a `tracker_transfers` report with `direction: 'import'`.
- Ids that differ from `<key>-<number>` (Linear's own prefix) follow into the dispatcher's state and the runs (`Dispatcher.rename`, `TaskRuns.rename`).
- The project becomes `builtin` with its key and no place (`ConfigStore.moveTracker`) and loses its profile link; the import's rows are dropped. The source's tasks are not marked or changed.
- The event log gets `eventLog.importStarted`/`Continued`/`Failed`/`Finished` and at the switch `importMatched` or `importMismatched`.
- While it goes, `ImportState.switching` (`{ stage: 'pass' | 'check' | 'switch', done, total }`, kept in the service, not the database) gives the window its stage and count. The log says when the switch begins, how many tasks the last pass took of how many, and when the check begins and how it ended.

Run live from Huly, GitHub and Linear, a restart mid-run and changes after the check included ([verified](../verified/trackers.md)); a file, a reply or an edit in Huly after the check: [unverified](../unverified/trackers.md#the-switchs-last-pass-passes-over-unchanged-tasks-btn-1432).
