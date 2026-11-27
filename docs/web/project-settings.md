# Page: project settings

A project's settings panel (BTN-97, BTN-117): the panel and its tabs, the save and the locked tracker, task sources and their windows, the tracker block, chain rules, status moves, what the session gets, machines. Shared with `/settings` and described once in `docs/web/settings-forms.md`: the layout, inheritance marks, tables, the draft and its save bar. Elsewhere: the transfer windows `docs/web/transfers.md`; milestone order, the built-in tracker's milestones and components `docs/web/milestones.md`.

## The panel and its tabs

The "Settings" tab over the side column (a tag in the project head where there is no column) opens a side panel at `#settings` (`web/src/pages/SettingsPanel.tsx`). The groups are tabs in its head (BTN-128; `GROUPS` in `web/src/pages/projectSettingsDraft.ts`):

- **Repository**: `repo`, `branch`, `mergeInto`, `carryAgent`, `slot`, `changelog`, `color`, `testProject`; then the "README badge" line that opens the badge's dialog at `?badge=1` (BTN-917, `docs/badge.md`, "The dialog"); then "Remove project" as a red-framed card of its own.
- **Tracker**: the tracker with its project key, `intakeLabel` (hidden for a GitHub tracker, BTN-262), `fillMilestone`, then "Task sources" and "Transfers" — together, so that one save cannot set a tracker apart from its statuses.
- **Sessions**: first the full-width "Project packages" button (BTN-914, `PackagesButton.tsx`; the packages open over the page at `?pkg=1`, the panel's hash kept, BTN-802, `docs/packages/page.md`, "The page"); `protection`; the Agent section (BTN-173: `provider`, `models.<provider>` and `accounts.<provider>`, '' in each being "as shared"; "Choosing a provider" in `settings-forms.md`); `brief`, `prompt`, `commands.beforeStart`, `promptLanguage`; "Standards" (BTN-359, `ProjectStandards.tsx`, `docs/sessions/protection.md`, "Project standards"); "What the session gets" (below); `cacheTtl`, the auto-compact windows of each agent, `contextHandoffs` (off, it disables the threshold and the shares), `stats.checkpointTokens` and the three `stats.checkpointShares`.
- **Check and CI**: `ci.guard` first, then `commands.check` and `commands.afterGreen` (one command per line), the rest of `ci` (BTN-103: a checkbox per CI kind, "Longest wait for CI, min" — empty is `null` —, `recheckMain`, `fixTask`, `rerunFailed`, `landingHold`); then `pullRequests` with "Add profile" in its block and a select per CI kind of `remoteProfiles` ("Automatic" and the profiles that could serve it, shown with two of them or a choice made, a removed one as "removed profile", BTN-231). With the guard off the rest is greyed out and disabled, its values kept (`.settings__guarded--off`).
- **Machines** (below), shown only where the hub has more than one machine.
- **Notices** (no draft): the notice kinds, "As shared" or a switch each (`docs/web/header.md`).

## The form and the save

- The keys set on both levels (`OWN_KEYS`, BTN-187: the five of `ci`, `fillMilestone`, `promptLanguage`, `cacheTtl`, `stats.checkpointTokens`, `contextHandoffs` and the three `stats.checkpointShares`) go into the form as `own`, only the project's own values, a key left out being "as shared".
- The save sends `POST /api/project/settings` with `{project, base, ...ProjectForm}` (`projectFormOf` checks only the shape; `ConfigStore.saveProject`). What a save writes is `docs/web/config.md`, "Saving".

### Locked tracker

- Once the chain has launched a task of a project (`launchedProjects` in `src/chain/launches.ts`: a launch that is not a release or a `-FIX` session), the page does not switch its tracker or tracker project: `ConfigView.trackerLocked` disables both with a "v0.2" badge and gives the profile field a "?" saying why, and a save that changes them anyway is refused with `config.trackerLocked`.
- A project with tasks in the built-in tracker cannot leave it either (`ProjectTracker.tsx` `hasTasks`, `config.builtinLocked`, BTN-769), and a project with tasks of another tracker is not offered the built-in one. The ways across are the transfer windows (`docs/web/transfers.md`).
- A `config-import` is not checked for either.

## Task sources

Another tracker for a live project is a task feed (BTN-66). The Tracker tab has "Task sources" (`FeedList.tsx`, BTN-553) under the tracker block: an "Add a feed" button at the heading's right, the main tracker's line first, then a row per feed (the line, then the tracker block with its place fixed), or one line saying where the chain takes tasks from without them. Each source is a box of its own, so where one ends shows.

- **Adding a feed**: the form opens only from the button, at the top of the list in an accent box titled "New feed", scrolled into view with its first field focused, so the press shows wherever the list was scrolled. It has the block, the key (only where the tracker's ids do not carry their own), the primary "Add a feed" and "Cancel". A feed is added and removed (its "⋯" menu, then a confirmation) at once, outside the draft and the bar (`docs/chain/entry.md`, "Task feeds").
- **A source's line** (`SourceLine`, `SourceDialog.tsx`): its tracker's icon, key and tracker, "Rules: its own / as in the profile", the unsaved dot and "Configure".

### The source's window

- "Configure" opens `SourceDialog` (the main tracker's tabs in `ProjectTrackerTab.tsx`): the parts as tabs — "Chain rules" (`RuleForm`), "Project tasks" (`MilestoneFields` and the milestone order, `docs/web/milestones.md`), then "Statuses on actions" (`SourceMoves.tsx`) — a new part being one more `SourceTab`, and one "Save" for all of them at the bottom. Full screen under 760 px.
- On the built-in tracker "Chain rules" has only the label table, "Components" replaces "Statuses on actions" (BTN-769), since its statuses are fixed (BTN-767). Its milestones are the built-in tracker's, "Only milestones" is unavailable with a note while it has none, and a save first creates each milestone the rules name that it lacks (`newMilestones`, `builtin/milestone`).
- The tabs differ in height, so the window stands at a fixed distance from the top: the head and the tabs stay put on a switch, and the bottom edge with the foot glides to the new height (`useHeightGlide`, `--motion-appear`).
- Closing keeps the edits: the row keeps its dot.
- **The main tracker's window** edits the panel's draft and saves through the panel's save, so the tracker and its statuses still go in one save. Its rules inherit from the profile of the tracker the draft names; switching the tracker in the draft puts the project's own `active` and `terminal` back to what the new one inherits (switching back restores them), with a warning band and "Configure" on the main line.
- **A feed's window** keeps its own draft (scope `feed:<project>:<feed>`, `FeedDialog.tsx`) and saves through `POST /api/project/feed/rules` with the keys it sets itself (`ownRulesOf`). It inherits from the feed's profile over the shared rules, not from the project (`feedRulesOf`), suggests only the feed's own tracker's vocabulary and tasks (`sourceTasks` by `FeedView.prefix`), and "From" says "feed" for its own rows.
- In `dev:fake` ABC's Linear feed has a `terminal` of its own, and XYZ too, so switching XYZ's tracker shows the warning.

## The tracker block

BTN-322, `TrackerFields.tsx`: one component for the wizard, the Tracker tab, each feed and the export window.

- The profile `Select` with its kind's icon and "Add profile"; on its row the fields of the kind's shape with the profile's projects suggested.
- A strip glued under each field (`FieldStrip`, `docs/design.md`) says the profile's state under the profile (`profileLine`: signed in as whom, refused) and the tracker's answer under the tracker project (`projectLine`: no such project or a failed list, the wizard's check, the name of an exact match). With the key fixed and no project field (Huly in the settings) a project error goes under the profile.
- In the settings (`ProjectTracker.tsx`, `keyFixed`) there is no tracker field: the profiles of every tracker are offered and the chosen one's kind is the tracker.
- A profile of the saved tracker is linked at once (`profiles/link`) while the tracker project goes into the draft, a Linear value split into a team and a project field (`placeFields`, joined back by `placeOf`), a blank one standing for the key.
- A profile of another tracker puts that tracker into the draft with an empty tracker project (one of the saved tracker puts both back as saved) and is linked once the save lands, since a profile is linked only to its project's saved tracker.

## Chain rules

BTN-334, `RuleForm.tsx`, the row logic pure in `ruleRows.ts` with tests. One form on the four levels: `/settings`, a tracker profile's group, the window of a project's main tracker and the window of a feed. On the built-in tracker the window's form has only the label table (`labelsOnly`, BTN-1429): its statuses are fixed, its labels are the project's own and the shared label rules apply to them.

### Statuses and labels

- Statuses are a table, a row per known status with a radio "in the chain / out of it / closed".
- A label is a row with one rule, "Required" or "Don't take", added from a field suggesting the trackers' labels; under the table "Take any / Only with a required label" ("any" drops the required ones). No label is a "Don't take" row by default (BTN-971), and a level adding a label starts from the inherited list (`withLabel`).
- Even Keel's own labels head the table, shown and not edited (`labelRows`): `QUESTION_LABELS` (`Question`, `Вопрос`) with the rule "question" — a mark of a task waiting for an answer, neither required nor excluded.
- Each row's "From" says where its value comes from — by category, built in, shared, `profile <name>`, project or feed. A row of another level is muted but whole and still editable; the level's own gets a reset that puts back what it inherits.

### What a level writes

- The values stay the lists of the config, inherited key by key, each list whole: a radio rewrites only the lists the status leaves or enters (`withPlace`), so moving a status in or out of the chain leaves an inherited `terminal` inherited, and a level back where the categories put every status writes `null`.
- A profile cannot keep `null` or `[]` over a shared list, so there "by the categories" is the list spelled out and a value equal to the inherited one is the key unset (`settled`).
- The project's form carries `ownRules`, the rule keys it sets itself, so the panel shows the profile's value for the rest (`effectiveRules`). A key is the project's own while its value differs from what it inherits (`ruleOrigins`), and the save writes it only then — `withProjectForm` compares each rule key with the profile's value over the shared one.
- The milestone rules are not chain rules: "Project tasks — all / only milestones [..] / all except [..]" (`MilestoneFields`), in a source's window and in a section of their own on `/settings`. A milestone the opposite list has is not offered (`withoutListed`), since the config refuses it in both.

### Suggestions

- The rules' statuses, labels and milestones come from the tasks the page knows and from what the trackers name (`knownStatuses`, `ruleChoicesOf`, EVK-1): the project's in its panel, all projects' on `/settings`, a profile's projects' in its group, a name once whatever its case.
- What a tracker names — every status (with its category) and label a task of the project can have, whether or not a task has it now — is `GET /api/projects/<id>/vocabulary` (the adapter's optional `vocabulary`, `docs/trackers.md`), read by `useVocabularies` as the panel or the page opens; the service keeps an answer five minutes (`src/tracker/vocabulary.ts`). So a project whose chain is empty still gets suggestions.
- A tracker without it, off or not answering (404, an error) adds nothing and shows no error: nothing waits on it.

## Status moves

BTN-554, `MoveFields.tsx`, the option logic pure in `statusMoves.ts` with tests. A section "Statuses on actions" of three picks — on task start, on pull request (with the hint that it works once PR mode is on), on task completion. Only for a kind that moves statuses (`ProfileKindView.moves`).

- Where: in a profile's tab of Chain rules (not on "All trackers"), in one form and one save bar with its rules (`ProfileRules.tsx`), and a tab of a source's window, the main tracker's and a feed's (`SourceMoves.tsx`).
- The picks offer what `profiles/statuses` lists for the profile, filtered by the rules as drafted: start and review the statuses in the chain, completion the done ones; a saved name the tracker no longer lists stays a choice.
- On the profile level the first choice is "leave as is" or "automatic", on the source level "as in the profile (<its value>)", and start and review add "leave as is".
- A new profile of such a kind gets one more step in the add dialog, "Task statuses" (`ProfileMovesStep.tsx`), filled with `defaultMoves`; without statuses read it says so and keeps only "Skip".
- The commands are `profiles/moves` (`{id, moves}`) and `project/moves` (`{project, feed: id | null, moves}`); the query `profiles/statuses` (`{id}`) answers the statuses or `null`.
- A move refused or out of the chain (`statusMove.*`, `TrackerView.moveFailures`) is a red band on the project page with "Open the statuses on actions", which opens the profile's tab or the project's Tracker tab by the notice's `level`; so does a refused close with a chosen status.

## What the session gets

BTN-340, `web/src/pages/SessionGets.tsx`, the facts pure in `sessionRules.ts` with tests. A section of the Sessions tab after `prompt`, for the agent the form names (the project's `provider`, else the shared one, unsaved edits included).

- It lists the instruction files a session of it reads (a note when Even Keel passes the lone one, when it reads both, or which file it leaves unread), whether the shared and the project's `prompt` are set, the project's skills it reads and those it misses with their folder, and the skills of the project's enabled plugin packages (a note when the agent takes no hooks, `pluginReach`).
- With no instruction file, prompt or skill it reached, a warning says the project has no rules. Under it a `<details>` holds the table of every agent from `src/agent/projectRules.ts`, the same as in the guide.
- The rules come from `ToolsView.rules` of `GET /api/projects/<id>/tools` (`useToolsViews`): `git ls-tree` of the project's branch, so an uncommitted file does not count (`docs/sessions/protection.md`, "Project rules for every agent"); `null` there — git could not read the branch — gives a line saying it is unknown.
- A project without git reads its folder instead (BTN-963, `docs/sessions/tools.md`): the section's hint and loader say "folder", and its standards take the documents from the folder, say so in the document's hint and in the warning of one gone from it, and have no "Shots and answers before the merge" switch — there is no merge to hold.
- `?tools=` of `dev:fake` varies them: `empty` has none, odd-letter projects only `AGENTS.md` and `.agents/skills`, the rest both files and `.claude/skills`.

## Machines

BTN-1271, `ProjectMachinesTab.tsx`, `ConnectMachine.tsx`, `projectMachines.css`, texts `t.pool`. A tab between Check and CI and Notices, shown only where the hub has more than one machine (`poolShown`). How the pool and the connection work is `docs/machines/page.md`, "The pool on the page".

- The card "Project machines": a row per machine of the pool (the online dot, the name, "this machine" on the own one, the folder with its full path in a tip, the slots tag when the project has slots, a switch that applies at once); "Connect a machine" under them while a joined machine is outside the pool.
- The project's `width` (drafted), with its limit under it ("Up to N: the project's machines", BTN-1571, `poolWidth.ts`), and the drafted switch `componentLanes` under it (BTN-1273, only where the tracker's vocabulary names components or the switch is on).
- "Connect a machine" is a dialog of the `add-package` classes portalled to the body (a form inside the settings' form would submit it); its job runs in `JobWindow` with Cancel's own note.
