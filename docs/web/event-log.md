# Page: the event log (BTN-350)

What happened while nobody looked: the service writes an entry for each event, a toast shows the warnings and errors that come while a page is open, and `/log` keeps them all.

## The log and its entries (`src/event-log/`)

- `EventLog` (`log.ts`) holds the newest `EVENT_LOG_LIMIT` (3000) entries, loaded from the state database's `event_log` at the start (`loadEventLog`) and written behind (`docs/storage.md`, step 29). It is a queue: an entry over the limit pushes out the oldest, from the database too; nothing goes by age, so no time setting is needed.
- An entry (`EventEntry`, `model.ts`) is an ascending `id`, `at`, a `level`, a `notice` (a code, translated on the page like any server message) and a `place` — where "Open" leads (`project`, `task`, `ask`, `backlog`, `ci`, `settings`, `packages` — the project's packages over its page, `/p/<id>?pkg=1`, `tracker` — the project's settings on their Tracker tab (`openPlace` before going), `accounts`) or `null`.
- Levels:
  - **info** — launches, stops and settings;
  - **warning** — what waits for a person: a question, a usage limit, work left in a folder, an uncounted CI failure, a CLI version Even Keel was not checked against, a package problem that does not hold its chain, an account's limits that cannot be read, a status of the chain rules gone from the tracker;
  - **error** — what holds a chain: a red main, a carry conflict, a chain paused on an error, the MCP gateway failing, a config error, a package problem while the project's packages hold its chain, an account's limits not read until a restart.
- The page gets the entries as `EvenKeelState.eventLog`; the hub sends them keyed by `id`, so a frame carries only the new ones.

## Sources: the state

`EventHub.watch('state', …, 2_000)` (`src/events.ts`) hands the state built for the page to `EventLog.observe` at most every 2 s, also while no page listens. An event may have several watchers, each on its own window, sharing one build (the demo's `demo.check` watches `state` too). `watchedOf` (`watch.ts`) reads from it the conditions below and each chain's pause and error.

### Page events

`pageEvents` (`src/event-log/page-events.ts`) are the conditions a person acts on. "Open" goes to the project's CI tab, the task's session, the backlog or the task's card; the state itself stays on the card after the toast.

- A chain held by the usage limit. A chain paused on the limit or a red main writes no pause entry of its own: the event says it.
- A red main: a failed run of main, an open fix of it or a paused `ci.*`/`check.*` with its commit — one key per project and commit, listing every failed CI kind once. The project's effective CI settings make it `red` (at least one counted kind with the guard on) or `ciRed` (only uncounted failures, a warning). Both name the failed CIs and open the CI panel; only `red` promises that the next task waits. Open fixes and failed local checks give `red` whatever the CI views say. `red` and `ciRed` have keys of their own: `ciRed` turning `red` writes an error entry and its toast, another optional CI failing on the same commit writes nothing, and a `red` marks its commit's `ciRed` as seen, so falling back to `ciRed` writes nothing either.
- While a commit is being judged, its counted CI's raw red is not an error (BTN-1001). `mainCi[project].judging` names the commit while the dispatcher waits on it: `MainCheck.view` derives it from the awaited push (`gate.check`: the push of a merge whose CI the chain waits on before the next task) or the late watch (the check of a run that finished after the gate gave up), including the first verdict's rerun request and the wait for the rerun. Once the dispatcher decides, the mark goes: red is one error, green none. An unsupported, denied or disabled rerun leaves the plain red verdict. The saved awaited push keeps the mark over a restart; the kept `gate.rerun` (the rerun already asked for that commit) alone never holds back a finished verdict. Uncounted CIs warn on their own, by the current guard and CI selection.
- A session waiting on `AskUserQuestion`.
- A carry held by `forward.conflict`, only while no agent is assigned to it (`ForwardView.agent` absent). Assigning one removes the event; skipping that session while the conflict stays brings the same key back — a new entry, as any condition back after a gap.
- Work left in the folder of a task out of the chain (`EvenKeelState.works`, `shownWork`): not one with a pull request and nothing uncommitted, not one a session is working in, and a closed task's only once its cleanup left a warning in `leftovers`; the service never gives work read before the task's session last acted (`docs/chain.md`). The chip and the callout are in `docs/web/project-page/notices.md`.

### Other conditions

- **A CLI on an unchecked version** is only in the log, the header has no banner of it: the installed CLI's entry opens Settings (its "CLI version", where Checked is chosen), a daemon's has no place — there is nothing to press for it (`docs/sessions/cli-versions.md`).
- **Package problems** (`ProjectPackages`: the set's own `problems` and those of each enabled package's cell) are an entry each, `eventLog.packages`, an error while `blocked`, else a warning; `installing` and `probing` pass by themselves and `unsupported` is the agent's, so they write none. A server that does not answer (`noResponse`) is probed once for every project with its package, so it is one error entry a package and server, not one a project (BTN-1248): `projects` lists them all (the text names them when more than one), the subject and "Open" are the first one's packages, and its key holds no project, so a project gaining or losing it writes no new entry. The gateway's own error stays its entry.
- **Unread limits**: an account of a shared or project pool whose `/usage` is `unread` (a warning) or `off` (an error), as the header's usage banner tones it (`usageNotices`), is `eventLog.usageUnread`/`eventLog.usageOff`, its reason as the cause; a new `since` is a new entry. The banners stay; the log keeps what they showed.
- **A status gone from the tracker** (BTN-1771): a status the chain rules name (`active`/`terminal`) that the tracker no longer lists is a warning `eventLog.statusGone` that opens the project's Tracker tab. Until the rules are fixed a merged task is not seen as done, old closed tasks read as open and a blocker in that status holds its dependents. Each full read of a reader (a project or a feed) puts its names into `TrackerView.missingStatuses` (`unknownStatuses`, `src/chain/rules.ts`), a failed read keeps the last ones. The key is the reader and the status: one entry while the status stays missing, a second status gone is an entry of its own, one gone again after it came back or the rules were fixed is a new one. The log cannot tell a status gone from one never there or one that went while the service was down: each writes one entry. Rules left at `null` name no status and write none. A feed's entry names its key (`feed`); the subject is its project.

### When a condition is new

- `observe` writes an entry for a condition that appears and for a chain that starts, stops, pauses, goes on or is held on a new error. A condition that goes and comes back is a new entry and a new toast: a carry conflict back after five minutes is news.
- Only a blink is the same one: back within `BLINK_MS` (5 s) of the first look without it. The state is built from parts read each on its own, and a failed or partial read may drop a condition from a build or two (one each 2 s window); the length guards against that, it was not measured.
- Nothing remembered yet (a fresh database) writes nothing: everything is old news.
- The memory (`EventMemory`: the keys seen, when each was first missed, the chains' marks) is kept in `service_state` as `eventLog.memory`. At a start each remembered condition counts as seen and, for `GRACE_MS` (10 min) after the start, as held though not seen (`Restored`): the state is read in parts then, so a restart repeats nothing that held before it. The grace is only for those; a condition first seen after the start has the blink alone.

## Sources: told by the service

### Launches and stops

A launch comes from the launch log (`launched`, `src/service/chain.ts`, `launchDraft`), a stop mid-turn from the chain (`stopped`). An entry of the launch log is a **launch** when `isLaunch` (`src/chain/launches.ts`) says so: a session started, went on or was replaced. Releases (`postpone`, `skip`), a fix's outcomes (`landed`, `dropped`, `unneeded`, `carried`) and `opened` are not; the stats' launches per day, Tally's `launchMap` and `closedStates` count the same way.

- A task's launch is told by its `previous` (BTN-853): none — a session started (`eventLog.launch`); the same id — the same session goes on (`eventLog.continued`, with `why`: `answer`, `review`, or a `resume`'s cause — `limit`, `credit`, `mainFixed`, `transient`, else `resume` for a log from before the cause was kept); another id — a new session in its place by a handoff (`eventLog.handoff`, `why` from the entry's `cause`, else its `restart` or `checkpoint`). A `review` entry without `previous` is a new session sent to a review, so a launch.
- A pull request opened on the session's mark is an `opened` entry: the task is out for review, no launch, and it reads "sent for review" (`eventLog.reviewOpened`). Older logs wrote it as a `review` without `previous`; those entries keep their text.
- A fix of main or a carry has no task, so its launch and stop name the project (`eventLog.fixLaunch`, `carryLaunch`, `fixStopped`, `carryStopped`), not `ABC-FIX` as if it were a task.

### Settings and the copy of a project's tasks

- Every settings change: `settingsSeen` from the config store's `onChange` (`src/service/hosting.ts`) — Even Keel's settings, a project's settings, a project added or removed; the first call only remembers. Changes are found by comparing `ConfigStore.raw()` as JSON, which depends on the order of keys: the store keeps its rows in one order (`sortedRows`, `src/settings/store.ts`) whether read from the database or just written, otherwise the first write from the page after a start logs every project as changed.
- The copy of a built-in project's tasks to another tracker (`BuiltinExports`, `src/builtin/export.ts`, BTN-1193) runs with no window open, so it tells the log itself, each entry placed at the project's Tracker tab, where the window is (`docs/web/transfers.md`):
  - `eventLog.exportStarted` — the tracker, its place, the new key and the tasks to take;
  - `exportContinued` — a start over a stopped copy or a finished one with new open tasks; a finished one with nothing to take writes nothing;
  - `exportFailed` — a warning with the tracker's answer as its detail, its hint names the "Continue" of the copy's window;
  - `exportFinished` — the tasks copied;
  - `eventLog.trackerSwitched` — the switch, with the old key and the new one, at the project.

  They are in the settings category: they change where the project's tasks live. A refusal before the copy starts (a wrong target, a tracker that does not answer) goes back to the open window and writes nothing.

## The page side

- **The subject** (BTN-852): an `eventLog.*` text never names the task or project it is about; `subjectOf` (`web/src/layout/eventLogFilter.ts`) takes it from the params — a `task` (with the project of the entry for its link), else the project (`projectOf`), else a removed project's `key` — and `EventSubject` (`web/src/layout/EventSubject.tsx`) draws it: a task number links to the task (`?task=`), a project label to the project, both as `.project-link`; an unknown project or a removed key is plain text. Other codes (a CLI version, the gateway, a config error) have no subject and keep their whole text. So a text reads after its subject — "asks a question", "main is red at a1b2c3d" — and a toast, which reads alone, puts the subject first (`EventTitle`: "ABC-4: asks a question").
- **Unread** (`useUnread`): per browser, the id of the last entry read is kept in `localStorage` (`even-keel.eventLog.read`), live across tabs. A browser that never saw the log starts with all of it read (`useFirstReadMark`, called from `EventToasts` on every page, since on a narrow screen "Log" mounts only with the opened menu). The header's "Log" (`LogLink`) carries the count of unread warnings and errors, amber, red when one is an error; the narrow menu's row the same.

### Toasts (`web/src/layout/EventToasts.tsx`)

- One for each warning or error that came after the page's first state (`freshAlerts`); info goes only to the log. At most `TOAST_LIMIT` (3) at once, an older one gives way. "Open" goes to the entry's place (`placePath` in `web/src/layout/eventLog.ts`), "Close" drops it; the entry stays in the log.
- A toast holds `TOAST_MS` (12 s) of the page in sight: `visibilitychange` to hidden stops the count and coming back starts it over, so a toast is not missed in a background tab. A pointer over the toast or the focus inside it stops the count too, and leaving goes on from the same place (BTN-845); a bar at its bottom shows the time left on the same clock (`ToastClock`, `web/src/ui/toastClock.ts`, through `useToastTimer`).
- Its words are `toastOf` (`web/src/layout/eventToast.ts`, BTN-1149): the subject, the title after it and one smaller line under them. A chain paused on an error (`eventLog.chainHeld` with a cause) is told by the error, not by the pause around it: the title is what happened (`t.events.titles` by the error's code, else the head of `sayLines`), about the task when the error names one and the project otherwise; the line under it is the causes and the one thing to do (`docs/web/language.md`, "Short messages"), and the pause's own hint shows only when the error has neither. Any other entry is its text after its subject with the hint of its code.

### `/log` (`web/src/pages/EventLogPage.tsx`)

- A card per day, newest first; a row is the time (full date in a tip), the level's dot with its name in a tip, the subject in a monospace column of fixed width (empty for an entry without one, a longer one cut with an ellipsis), the text with its projects as links, a "new" chip on what was unread at opening, and "Open" where the entry has a place — an arrow `.row-action` that shows on the row's hover or focus (`docs/design.md`, "Buttons"). Opening the page marks everything read. An empty log says what will show and has a button to the projects.
- The filter bar: one level, category and project choice, combined with AND; Reset clears them. Three equal selects and Reset, always there and disabled while nothing is chosen, so a choice moves nothing (BTN-852); on a narrow screen each takes its own line.
  - The level is a threshold: All, "Warnings and errors" (`level=warning`), "Errors only" (`level=error`); an old `level=info` reads as All.
  - The URL alone stores `level`, `category` and `project`, with replacements rather than extra history entries. Unknown levels or categories and project ids absent from `state.projects` act as All; the address is rewritten only on a choice or reset. Repeated parameters use their first value.
  - Project options follow `state.projects` order and use `projectLabel`: only projects with log entries, plus a selected existing project whose entries have gone, which keeps the empty result and a readable name. The project comes from the entry's place, then its string `notice.params.project`, never from a project key; entries without a project disappear under a project filter.
  - Categories are derived on the page by `web/src/layout/eventLogFilter.ts`: sessions, chain, questions, main and CI, accounts and limits, packages, settings, system. Its exhaustive `eventLog.*` map is checked by TypeScript; every code outside it falls back to `system`.
  - Day cards and minute marks use only visible entries. A wholly empty log hides the filters and keeps the link to projects; an empty filtered result keeps the filters and offers Reset filters. Filtering never changes the read mark (the entire log is marked read), the opening-time new marks, toasts or the unread count. Incoming entries follow the current URL filter.
- Fake data: `dev:fake` has a day of entries of every kind (`fakeEventLog`); `?event=…` and `?log=empty` are in `docs/web/fake-states/setup-limits-accounts.md`.
