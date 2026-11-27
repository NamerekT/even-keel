# The tracker layer: the link, label and status writes, contract tests

How a profile's connection and poll behave, two write capabilities the page and the chain use (labels, a chosen status), and the contract tests on live trackers. The terms (reader, kind, status categories) are in [`layer.md`](layer.md#terms).

## The connection

Each profile in use has its own connection and poll (`src/tracker/link.ts`, `poller.ts`) and a card on the `/status` page (`TrackerView`: its state, the last good poll, the error and, per project and feed it reads, when it last read it — `readAt`, `docs/web/project-page.md`). A project's task feeds (BTN-66, `docs/chain/entry.md`, "Task feeds") are read as projects of their own ids, each on its own profile.

- **A failed call** closes the connection, and the next one connects again.
- **`TrackerNotFound`** (BTN-317) is the exception: the project, team or issue asked for is not there. Closing then would fail the calls of the profile's other projects under way ("Connection closed" in Huly), so one project deleted or renamed in the tracker would stall them all. A project's read that fails this way on every refresh is logged once, and once more when it reads again.

## Links to tasks and projects

- **A task link** goes by the tracker of its project or feed (`trackerUrls`, the `issueUrl` template with `{id}` or `{number}`). A task of no known project goes by the default profile of the tracker most projects run on (`trackerUrls.default`, `linksTracker`: a tie goes to the first project's; no projects — no link). The stats link a task by the address its launch recorded, the template only without one.
- **A project's page in the tracker** (`trackerUrls.pages`, by the project's or the feed's id, BTN-329; the optional `projectUrl`, checked live): a project with nothing to run links to it, and to each feed's. Until the address is known the button is not shown.
  - GitHub — `https://github.com/<owner/repo>/issues`.
  - Huly — `<url>/workbench/<workspace>/tracker/<project _id>/issues`, the `_id` learned on the first read of the project's tasks (`HulySource.projectIds`).
  - Linear — the team's `https://linear.app/<urlKey>/team/<KEY>/all`, or for a key narrowed to a Linear project that project's `url` + `/issues`, known after the first read (`LinearSource.projectUrls`).

## Timeouts and the read back-off

- A call that times out logs its operation, elapsed time and request count once until that read succeeds; the recovery logs the count of the failures.
- Automatic task and chain reads pass a retry key to `TrackerLink.run`: after successive timeouts the same read waits 20, 40, 80, 160, then at most 300 seconds, without reconnecting meanwhile. Other reads do not clear its count; a profile reset clears the delay. A broken connection counts as a timeout: the tracker did not answer either way (Node's `fetch failed` with the reason in `cause`, or the request's own timeout).
- The call's abort signal cancels outstanding HTTP work through `trackedFetch`.
- A successful call over half the timeout logs its measurements at most once per ten minutes per operation and profile. GitLab, GitHub, Linear and Jira count the HTTP requests of each call and name the longest one's path without its query or upload secret; Huly reports no count.

## A tracker that did not answer (BTN-825)

The link remembers the error of a tracker that did not answer — a timeout or a broken connection. While it holds, every call the page asks for fails at once with that error, its code and text the same as after the timeout, instead of waiting the whole timeout again.

- **The page's calls** go through `TrackerLink.page`: the card (`GET /api/tasks/<id>`), a file of a task, the task's actions ("Into the chain", "To the backlog", labels, milestone) and the changelog's list of a milestone.
- **The vocabulary** — the page's (`GET /api/projects/<id>/vocabulary`), a session prompt's roles line and the check below — goes through `TrackerLink.aside`, held the same way; its own refusal neither puts the tracker down nor brings it back (EKR-106).
- **The chain's reads** keep going through `TrackerLink.run`: they are what brings the tracker back, and they wait their own delay.

Any call that answered, even "not there", clears the memory. `GET /api/projects/<id>/tools` reads no tracker (only the project's folder and the account folders), so a silent tracker never holds it.

## A vocabulary refused while tasks are read (EKR-106)

A full read of a reader reads its vocabulary too, once each time the link turns live (a saved token resets the link). A refusal with a notice, such as Forgejo's `forgejo.scope` for `read:organization` on an organization's repository, goes into `TrackerView.termsRefused` by reader, and the project page names the project or feed it holds with the notice and its fix. A refusal without a notice is retried on the next read. Each text is logged once. A session prompt that leaves a tracker's roles line out says so in the log: `prompt: the <KEY> chain line is left out: <why>`.

## Writes of the tasks server (BTN-929)

`tasks_create`, `task_update` and `task_comment` go through `TrackerLink.write` with the operation's name (`create`, `update`, `comment`), which the log uses instead of the last method called.

- **The timeout bounds the tracker's silence, not the call.** Every answer gives the call the whole `timeoutMs` again: an HTTP request answered through `trackedFetch` (`CallDiagnostics.onAnswer`), or a settled call of the source, its `editor` or the editor's `files`/`markers` (so Huly, which counts no HTTP, too). A batch of tasks with files and links on a slow GitLab.com runs to its end.
- **After a timeout** every next call of the source inside that write throws, and the batch stops rather than go on behind the session's back. A write that timed out after an answer leaves the tracker `live`, keeps the connection and holds no page call; one without any answer is the tracker not answering, as for a read.
- Writes are never delayed by the read back-off, and each failure is logged. A `tasks_create` the tracker broke off answers with the tasks created before it and tells the session to repeat with the same `retry` (without one, to read `tasks_list` first).

## Status polling

Consecutive failures with the same error text (its cause included) are logged once per profile; a changed error is logged again. The first good poll after a failure logs `<profile title>: reads again`, even if no status changed. With no watched tasks the poll is skipped and does not count as recovery. Project refreshes keep their own failure state.

## Writing task labels (BTN-507)

`TaskSource.relabel(id, { add, remove })` (optional) returns the saved label names. `trackerOf` forwards it only when present; a connected tracker publishes it as `trackers[].relabel` (absent in older snapshots — false). It removes first, then adds; names are trimmed and compared with `toLocaleLowerCase`, as in `toTask`. Existing labels keep their spelling, other labels stay, and an empty add list may remove every label.

| Adapter | Label definitions and the write |
| --- | --- |
| Huly | Workspace issue `TagElement`s; a missing definition is created in `core.space.Workspace`, in the default issue category or `tracker.category.Other`. `TagReference`s are removed and added through collection operations, which keep the issue's label counter; returns the references read back. |
| GitHub | Pages the issue's and the repository's labels; creates missing repository labels with `createLabel`, then writes `updateIssue.labelIds` once and returns its labels, paging the rest. |
| GitLab | Reads the issue's and the project's labels (ancestor group labels included); creates missing project labels, then replaces `labels` in one issue update and returns the saved names. |
| Linear | Pages the issue's labels and the team's available ones (workspace labels included, groups excluded); creates missing labels with the issue's `teamId`, then writes `issueUpdate.labelIds` once and returns its labels, paging the rest. A mutation with `success: false` is a refusal. Adding the name of a label group (`isGroup`) no usable label shares is refused with `task.labelGroup` before any write (BTN-668): Linear puts no group on an issue and creates no label under a group's name. |
| Jira | Labels are free strings: replaces `fields.labels` and reads the saved names back, since Jira's update answers empty. No definition is created. |
| Forgejo | Reads the issue's labels, the repository's and its organization's, then replaces the issue's labels by id (`PUT …/labels`) and returns the saved names; a missing label is created in the repository, grey. A user's repository answers 404 for organization labels, taken for none. A token without `read:organization` gets 403 first; then the repository's `/teams` decides: 405 is a user's repository, anything else keeps the scope error, so a relabel never makes a repository twin of an organization's label (EKR-106). |
| Built-in | The project's own label list (`BuiltinStore.relabel`); a new name creates the label. |

`POST /api/task/labels` takes `{ task, add: string[], remove: string[] }`; both lists are required, an empty one is allowed. `taskControl` (`src/tracker/control.ts`) routes by the task's reader, feeds included.

- **After a write** it refreshes the reader at once, as `ready` does: labels can admit a task to the chain, so `fillMilestone` must run before it enters. Without a refresher it patches the reader's task with `toTask`, updates the chain and broadcasts the state, the derived question flag included. Neither waits for the next poll; the card is read afresh through its GET route.
- **Refusals.** An adapter without `relabel` gives `task.cannotRelabel`; a failed read, create or write gives `task.relabelFailed` with a fix link to the tracker profiles; a refusal the adapter names itself (a `NoticeError`, such as `task.labelGroup`) reaches the page as it is. The underlying error stays the cause, never page text. Every refusal of this route, "Into the chain" and "To the backlog" logs a `relabel:` line with the task, the tracker and the cause.
- **No transaction** spans tracker requests: a failed write may have created a definition or changed some Huly references. Refresh the task before retrying.

Fixtures cover the six outer adapters (`src/tracker/relabel.test.ts`: case matching, missing definitions, pagination, clearing, failures, service state, HTTP validation) and the built-in store. Every outer adapter, refusals included, was checked live ([verified](../verified/trackers.md)).

## Moving a task to a chosen status (BTN-554)

The optional pair `TaskSource.moveTo(id, name)` and `statuses()`, and the optional `name` of `complete(id, name)`. `moveTo` moves a task to the status of that name (compared as `sameName` does) and answers the status it is in, `null` when the tracker has no way there; `statuses()` lists every status the profile's tracker has, each name once (`uniqueStatuses`). Huly, Linear, Jira and the built-in tracker have them; GitHub, GitLab and Forgejo do not. A kind's view carries `moves: true` for the page.

| Adapter | `moveTo`, `statuses`, `complete` with a name |
| --- | --- |
| Huly | The status of the name in the project type (`namedStatus`), written as any status change; every issue status of the workspace. `complete` takes the named one only of the `Won` category, another is an error. |
| Linear | The state of the name in the issue's team (`moveState`); `workflowStates` of every team the key sees, paged by 50. `complete` takes the named `completed` state of the team. |
| Jira | The workflow's transition into a status of the name; none — logged and `null`. `/rest/api/3/status` for the list. `complete` takes a transition into a Done-category status of that name, none is an error. |
| Built-in | Its fixed statuses (`BUILTIN_STATUSES`). `complete` takes a named status only of the `Won` category, another is `tracker.completeRefused`. The chain's moves are fixed for it ([`builtin.md`](builtin.md#the-built-in-tracker-btn-767-srcbuiltin)). |

### The moves of a start and a pull request

`StatusMover` (`src/tracker/mover.ts`) moves a task when Even Keel starts it (`start`) and when it opens the task's pull request (`review`), by the profile's moves and the source's over them (`movesOf`, `src/chain/moves.ts`). It moves only forward (`moveVerdict`): on a start only a task of the `ToDo` category, on a pull request any open one, never one already there. A target the rules keep out of the chain is not tried (`statusMove.outside`): the chain would let the task go at once. A refusal or an error is logged and never stops the chain; it stays in memory by reader (`trackers[].moveFailures`) until a later move of the task goes through, and the page shows those of open tasks.

### The closes

Every close takes the chosen done status (`doneMove`) through one function, `closeInto` of `src/tracker/close.ts` (BTN-1163). A status the rules do not take for done is not tried (`statusMove.notDone`); a refused one is `tracker.completeRefused` with `status` and `level` (`profile` or `source`), which leads the notice's button to the setting. The closes are five:

1. A merge (`MergeCloser`, retried on each read).
2. A merged pull request (`Reviews.apply`). A refusal goes into `PendingCloses`, which the reader's `MergeCloser` retries whatever the main branch has of the branch, and shows with its own.
3. A pull request with nothing to open (`Reviews.doneWithout`).
4. A `NO CHANGES:` or `TASK DONE` mark (`UnchangedDeps.complete`, wired in `src/service/closing.ts`).
5. "Accept as answer" (`UnchangedDeps.accept`), which checks the status before it comments.

Closes 3–5 are `held`: a refusal pauses the chain or refuses the button with the notice as its cause, never "retries by itself".

## Contract tests on live trackers (BTN-470, `src/e2e-trackers/`)

The adapters' unit tests run on recorded answers and do not see a live API change. `src/e2e-trackers/contract.test.ts` is one set of cases over `TaskSource` and `TrackerAdapter`, run against each stand in turn. A **stand** is a test project on a live tracker for this set; it is not a bench, a machine with the service for live checks (`stands/README.md` of the backstage repository).

The cases: sign in (`account`), list projects, `create` a task and read it back in a `ToDo` status (`tasks`), find it among `chainTasks`, `brief`, `unready` and `ready`, `moveTo` the stand's `active` status, `relabel` on and off, two comments and `commentsAfter`, the `card`, a `blocks` pair read from both sides, and `complete` — `true` once, then `false`.

- A case the stand cannot run is skipped with its reason in the report — a method the adapter lacks (GitHub, GitLab and Forgejo have no `ready`/`moveTo`), no task created, no pair seeded — so a skip never passes as green.
- The set writes no link and deletes nothing: each stand's `blocks` pair is seeded once by hand and stays open in the backlog, and the cases' own task is closed at the end, after a failure too.
- A new tracker is one more stand, not a new set. The CI adapters (`src/ci/`) are not in it yet.

### Stands and the run

- A stand (`Stand`, `stands.fixture.ts`) is a name, the adapter, a profile's values, the project's `place` (the key and the `projectKey` value), optionally `blocks: [blocker, blocked]`, `active` and `done`.
- `EVEN_KEEL_TRACKER_STANDS` holds the list — the JSON itself or the path of a file with it. Empty, the set runs nothing, and on CI it fails: a night without stands checks nothing. An adapter without a stand is listed as a skip.
- `EVEN_KEEL_TRACKER_STANDS_SKIP` and `EVEN_KEEL_TRACKER_STANDS_ONLY` (stand or adapter names, comma-separated; `selectStands`) pass over some stands or run only those, each skipped one listed with its reason. An `ONLY` name no stand has fails the run, and so does a CI run with every stand skipped.
- `npm run test:trackers` runs it; `npm test` and `test:all` leave it out. The stands are the maintainer's test projects on Huly (workspace `ekcheck`, EKW), GitHub, Linear, Jira Cloud, GitLab.com and Forgejo; the file is built from the benches' tokens outside this repository.

### The nightly workflow

`.github/workflows/trackers-e2e.yml` ("Tracker contract") runs every night at 03:00 UTC on `dev`, and by hand, with the stands from the secret `TRACKER_STANDS`. The self-hosted stands are reached over the tailnet: with the secrets `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` (a Tailscale OAuth client for `tag:ci`) the job joins it first; without them `TRACKER_STANDS` holds only the stands on the internet.

**Huly runs before a release, not every night** (BTN-1489): the self-hosted Huly is up only on demand.

- The workflow's `ON_DEMAND` (`huly`) names such stands. The night and a plain run by hand skip them (`EVEN_KEEL_TRACKER_STANDS_SKIP`); a run by hand with the input `on_demand` runs only them (`EVEN_KEEL_TRACKER_STANDS_ONLY`), titled "Huly contract" (`run-name`). It is one file, not a second workflow, because GitHub dispatches only workflows already on the default branch.
- `scripts/huly-contract.sh` on the workstation does the step: it brings Huly up, runs `gh workflow run trackers-e2e.yml --ref dev -f on_demand=true`, finds the new run by its title, watches it and brings Huly down — after a failure or Ctrl+C too — and exits with the run's result. The up and down commands are the host's, `EVEN_KEEL_HULY_UP` and `EVEN_KEEL_HULY_DOWN`, from the environment or the file `EVEN_KEEL_HULY_STAND` names (`~/.config/even-keel/huly-stand` by default); the stand's address and ssh host are never in the repository. The up command returns once Huly answers.

A red night, or a red or missing "Huly contract", holds every release: `scripts/nights-green.sh`, run by `publish.yml` before `npm publish`, covers every nightly workflow ([`docs/ci/workflows.md`](../ci/workflows.md), `docs/releases.md`, "A release"). A red night here is lifted by a fix on `dev` and a green run by hand (`gh workflow run trackers-e2e.yml --ref dev`); a red or missing Huly contract by a green `sh scripts/huly-contract.sh`.
