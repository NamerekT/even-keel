# Inventory

"Levels": G — Even Keel, P — project, T — task; the tracker profile, the feed and the machine are named where they
apply (`levels.md`). "Written by": page, hand (a file through `config-import`, `docs/storage.md`), service. Every key
applies at once, without a restart of the service (BTN-130). The keys are those of the config's format, which the
database's rows keep (BTN-199). A cell gives what the key is; how its feature behaves is in the document it links.

### The settings (`setting_values`)

| Key | Levels | Merge | Written by | Default |
| --- | --- | --- | --- | --- |
| `parallel` | G | — how many chains run at once; with machines, the own machine's capacity, set on its machine page (`docs/machines/pool.md`, "The pool") | page, hand | 1 |
| `width` | P | — how many of the project's tasks run at once, each on another machine of its pool (BTN-993, BTN-1569), at most the machines of its list (`config.widthOverMachines`, BTN-1571; `docs/machines/pool.md`, "The pool") | page (the project's "Machines" tab), hand | 1 |
| `componentLanes` | P | — "Lanes by component" (BTN-1273): a lane takes no task of the tracker component a sibling lane holds (`docs/machines/pool.md`, "The pool") | page, hand | false — lanes take tasks by the order alone |
| `tracker` | P | — a project's own: every writer stores it, so no later default moves a project (BTN-345). `builtin` — the built-in tracker, left only by the switch after a copy of its tasks (`config.builtinLocked`; `docs/trackers/copy.md`, "The switch to the copy's target") | page, hand | `github`, only for a project of a hand-written file that names none |
| `brief` | G, P | P over G; `null` — auto: on exactly when no enabled package of the project brings its tracker's MCP server (`bringsServer`, BTN-225); the built-in tracker's is `tasks` (BTN-1680) | page, hand | `null` |
| `chain.active`, `chain.terminal` | G, profile, P | each key P over the profile's over G; `null` — back to the status categories | page, hand (not the profile's) | `null` |
| `chain.requiredLabels` | G, profile, P | each key P over the profile's over G, the list replaced whole | page, hand (not the profile's) | `[]` |
| `chain.excludedLabels` | G, profile, P | each key P over the profile's over G, the list replaced whole; no label is excluded unless a list names it (BTN-758, BTN-971) | page, hand (not the profile's) | `[]` |
| `chain.requiredMilestones`, `chain.excludedMilestones` | G, P | each key P over G, the list replaced whole; one milestone in both is `config.milestoneBoth`; projects on one tracker project must split it (`config.trackerProjectShared`, BTN-172, `docs/chain/projects.md`) | page, hand | `[]` |
| `provider` | G, P | P over G | page, hand, service (the "Even Keel" role, the account the service runs on, moved to another account: `saveActive`, `docs/accounts/folders.md`) | `claude` |
| `models.<provider>` | G, P | by provider, P over G; OpenCode's by the provider its account signs in to, `models.opencode/<vendor>` (BTN-984, `docs/sessions/models.md`) | page, hand | `{ claude: 'opus' }` (`DEFAULT_MODELS`); another provider's is its CLI's own |
| `accounts.<provider>` | G, P | by provider, P over G | page, hand, service (`saveActive`) | `{ claude: 'global', codex: 'codex' }` |
| `execution.<provider>` | G | — the transport of the provider's sessions; `claude: sdk` needs `cli.claude: checked` (`config.executionCli`, `docs/sessions/sdk.md`) | page, hand | the first mode of each provider: `claude` — `auto` (`bg`, `sdk`, BTN-353), `codex` — `sandbox` (`bypass`) |
| `cli.<provider>` | G | — which CLI sessions run on: `system` ("Yours", the installed one), `checked` (Even Keel's copy of the checked version), `latest` (its copy of the newest release, offered only where the CLI cannot be installed) (`docs/sessions/cli-versions.md`) | page, hand, service (a failed download switches that provider to `system` unless its execution needs the copy, `ConfigStore.fallBackCli`) | `system` (BTN-603) |
| `modelPrompts.<pattern>` | G | — ordered prompts matching `provider \| model`, added to new sessions' prompts only (`docs/sessions/models.md`, "Model prompts") | page, hand | `{}` |
| `language` | G | — | page, hand | `null` (the browser's) |
| `promptLanguage` | G, P | P over G | page, hand | `language`, else `en` |
| `hiddenSkills` | G | — | page, hand | `DEFAULT_HIDDEN_SKILLS` |
| `protection` | G, P | fields merge; each project's native-rule or disabled-group list replaces the shared field; new launches only (`docs/sessions/protection.md`, "Protection") | page, hand | all twelve built-in groups on (six command groups, one per tracker); no extra native rules |
| `cacheTtl` | G, P | P over G; a project's `null` is its own value (the CLI's). Chain sessions only (`docs/sessions/cache.md`) | page, hand | `"5m"` since BTN-1401; a value stored before stays |
| `cacheTrial` | G | — a measuring tool, no field on the page (BTN-1412, `docs/sessions/cache.md`, "The cache trial") | hand | false |
| `autoCompactWindow`, `codexAutoCompactWindow`, `openCodeAutoCompactWindow` | G, P | P over G; a project's `null` is its own value; see the note under the table | page (the Agent card's window column, shared and project), hand | `null` — the account's or the model's window |
| `keepWarm` | G | — whole hours 0–24 a waiting chain session's cache is kept warm after its last answer; 0 — off (BTN-437, `docs/chain/exceptions.md`) | page, hand | 2 since BTN-1401; a value stored before stays |
| `chatSessions` | G | — an integer ≥ 1: project chat sessions a machine keeps up (BTN-1653, `docs/sessions/project-chats.md`) | page, hand | 3 |
| `cliCheck` | G | — the service runs the live CLI check on a new CLI version and weekly (BTN-569, `docs/releases.md`, "The automatic run in the service") | page, hand | false: it spends the account's limits |
| `switchOnLimit` | G | — "Go on where a limit is left": a task not launched yet leaves a machine whose limit is spent for one with limit left (BTN-996, `docs/machines/pool.md`, "Past a limit"); on only through the warning on provider terms | page (shown with more than one machine), hand | false: switching to another of one's own paid accounts on a limit is at the user's risk |
| `allowedHosts` | G | — | page, hand | `[]` |
| `machinesAddress` | G | — "Hub address for machines": the name or IP, `:port` when another is forwarded; set — the hub listens on `EVEN_KEEL_MACHINES_PORT` (BTN-1242, `docs/machines/elsewhere.md`, "Machines elsewhere") | page, hand | `null`: machines do not connect |
| `memoryMirror` | G | — "Mirror repository": the address git pushes each project's memory repository to; refused with spaces, a leading `-` or a password in it (BTN-1649, `docs/sessions/memory.md`, "The mirror") | page, hand | `null`: no mirror |
| `attachmentLimit` | G | — whole megabytes 1–1024, the largest file a built-in task takes and a session attaches through the tasks server, read per upload (BTN-773, BTN-895; `docs/trackers/builtin.md`, "Attachments", `docs/trackers/tasks-server.md`) | page, hand | 25 |
| `backup.dir` | G | — an absolute folder of the state database's automatic copies; `null` — `backups/` in the state folder (BTN-1083, BTN-1179, `docs/storage/backup.md`) | page, hand | `null` |
| `backup.keep` | G | — whole checked copies 1–365 the rotation keeps, the copy before schema steps among them | page, hand | 14 |
| `defaultGit` | G | — the setup's answer to "Use git?", the mode the project wizard starts on; `null` — not asked yet. Never inherited (BTN-886, `docs/web/setup.md`) | the setup's Git step, page, hand | `null` |
| `setupPassed` | G | — the setup's steps passed with no setting of their own to tell it (`PASSABLE_STEPS` in `src/setup.ts`; BTN-1023, `docs/web/setup.md`); read only by the page | the setup, hand | `[]` |
| `context.warn`, `context.danger` | G | — warning and danger thresholds, percent of the window the session's agent reports | page, hand | 50, 80 |
| `stats.compare.*`, `stats.moves`, `stats.otherBelow` | G | — | page, hand | `DEFAULT_COMPARE`, `{}`, 0 |
| `contextHandoffs` | G, P | P over G; `false` — no handoff by context size, the agent's own compaction keeps the context (BTN-255, `docs/sessions/checkpoint.md`) | page, hand | `true` |
| `stats.checkpointTokens` | G, P, T | T over P over G; a value pins the threshold and turns the calibration off, a project's `null` calibrates it | page, hand, task label | `null` (calibrated per project) |
| `stats.checkpointShares.first`, `.late`, `.hard` | G, P | each key P over G; whole percents 1–100, `first < late < hard` on what each level ends up with (`config.checkpointShareOrder`); ignored while the threshold is pinned (`docs/sessions/checkpoint.md`) | page (the project's panel sets the three together), hand | 72, 85, 95 |
| `tally` | G | — `off`, `local`, `server` (`docs/stats.md`) | page (the setup's stats step, Settings → Stats, `stats/tally`), hand, service (the mode an older install ran on, at startup) | `null` — not chosen, nothing collected |
| `updates.check`, `updates.notify` | G | — | page (the check also in the first run's setup, BTN-310), hand, service (`muteUpdates`) | true, true; the check is held during the first run (`docs/web/header.md`, "Updates") |
| `notices.<kind>` | G, P | by kind, P over G; a project holds only the project kinds; an unknown kind is `config.noticeKind` (BTN-759, `docs/web/header.md`, "The banners") | page ("Don't show again", Settings → Notices, `notices/mute`), hand | `{}` — every kind shown; Even Keel's `true` leaves no row |
| `unattended` | G | — | page (a switch on `/settings`, `chain/unattended`), hand | false |
| `trimTools` | G | — | page (a switch on `/settings`, `chain/trim`), hand | true |
| `homeShowTests`, `statsShowTests` | G | — the "Test projects" switches of the home page and of `/stats`, each on its own (BTN-1364, `docs/web/home.md`, `docs/stats.md`) | page (`view/tests`), hand | false — test projects hidden |
| `slot` | P | — | page, hand | none (a worktree per task) |
| `slotCleanup.clean`, `.keep` | P | — `.gitignore` patterns from a slot's root: after Done `clean` is deleted save what `keep` matches; `!` is refused (`config.slotCleanup`, BTN-1315, `docs/chain/worktrees.md`) | hand | `[".temp/**"]`, `[]` |
| `git` | P | — `false` reads `slot`, `pullRequests`, `mergeInto` and `ci.guard` as off (BTN-883, `docs/guide/chain.md`, "A project without git") | the project wizard; later only "Turn on git" on the Repository tab, between tasks (`project/git`, BTN-884; never back to `false`, BTN-1063), hand (`config-import` takes `false` as it is) | true |
| `testProject` | P | — hides the project from the home page and the default stats; collection and chains go on (BTN-206, `docs/stats.md`) | page (Repository → Test project), hand | `false` |
| `color` | P | — | page (with the repository), hand, the wizard (the first free one) | none: the first slot of 1–8 no project has as its own, in config order (`colorsOf`, `src/projects/colors.ts`); none left — `--series-other` |
| `changelog` | P | — a path relative to the repository's root; absolute or `..` is `config.changelogPath` (BTN-209, `docs/sessions.md`) | page, hand | `CHANGELOG.md` |
| `standards` | P | — the project's standards, `{ doc, files, except, shots }` each (`config.standards`, BTN-359, `docs/sessions/protection.md`, "Project standards") | page, hand | `[]` |
| `prompt` | G, P | adds up, not over (BTN-338): a new session gets G, then P (`withPrompts`); a project's empty one leaves G in place | page, hand | `null` on both |
| `commands.beforeStart`, `.check`, `.afterGreen` | P, machine | each key on its own; a machine's list replaces the project's (`levels.md`, "A machine in a project") | page, hand | `[]` |
| `ci.guard`, `.kinds`, `.waitMinutes`, `.recheckMain`, `.fixTask`, `.rerunFailed` | G, P | each key on its own, P over G over `DEFAULT_CI`; a project's `waitMinutes: null` is its own value (`docs/ci/layer.md`) | page, hand | `DEFAULT_CI` |
| `fillMilestone` | G, P | P over G | page, hand | false |
| `landingHold` | G, P | P over G — while a session of the project resolves its landing, no lane of it starts a new task (BTN-1582, `docs/chain/worktrees.md`, "The hold while a landing resolves") | page (Check and CI → "Main and its check"), hand | true |
| `milestoneOrder` | P | — milestone labels, trimmed and deduplicated (`config.milestoneOrder`), the order the chain ranks live milestones by: a label not in it goes after its closest automatic predecessor, one gone is ignored (BTN-792, `src/chain/milestone-sequence.ts`, `docs/web/milestones.md`) | page ("Milestone order" in the main tracker's window, `project/milestone-order`), hand | `[]` — the automatic order |
| `badge` | P | — `{ on, url, slug, fields }` (`config.badge`, BTN-915, `docs/badge.md`) | the badge's dialog (Repository → "README badge", BTN-917), `config-import` | `null` — no badge |
| `mergeInto` | P | — the key of a main project (`config.mergeInto`); the page also refuses a checkout of another repository (`config.mergeIntoForeign`, BTN-285, `docs/chain/projects.md`, "Carrying a release project forward") | page, hand | `null` — a main project |
| `carryAgent` | P | — read only for a release project; unattended mode acts as if it were on (BTN-370, `docs/chain/projects.md`, "The carry session") | page (under "Merges into"), hand | false — a carry conflict waits for "Resolve with the agent" |
| `pullRequests` | P | — PR mode (BTN-205, `docs/chain/pr-mode.md`) | page, hand | false |
| `intakeLabel` | P | — the label that takes GitHub issues in (BTN-262, `docs/trackers/github.md`, "Taking GitHub issues in") | page (the Tracker tab, not for a GitHub tracker), hand | `null` — no issues taken in |
| `statusMoves` | profile, feed, P | each of `start`, `review`, `done` P over the profile's (`tracker_profiles.moves`, not in `config-export`); a feed's `feeds[].moves` over its profile's instead (BTN-554, `docs/chain/entry.md`, "Status moves") | page (the profile in "Whose rules" of Chain rules, the source's window in the Tracker tab), hand (not the profile's) | `{}` — nothing moves, the close is automatic |
| `remoteProfiles` | P | — the GitHub, GitLab and Forgejo profile ids the remotes' CI and pull requests take; a missing or unfit one is the automatic choice (BTN-231, `docs/ci/layer.md`, "Which CI a project has") | page, hand | `{}` |

**The auto-compaction windows** are positive whole tokens, each for the chain sessions of one agent: `autoCompactWindow`
Claude's, `codexAutoCompactWindow` Codex's (BTN-810), `openCodeAutoCompactWindow` OpenCode's (BTN-856, a ceiling taken
only below the chosen model's window). A live edit reaches new launches only: Codex and OpenCode keep the launch's
window in the session's record for its later turns. Hand sessions and the agents' own config files are untouched. How
each agent is told: `docs/sessions/models.md`, "The auto-compaction window".

Project record fields, not settings — the table `projects`: `id` (written by the service for an entry without one,
`withIds`), `key`, `name`, `repo`, `branch`, the tracker's project (`github`, `huly`, `linear` by
`TrackerAdapter.projectKey`) and the extra task feeds (`feeds`, BTN-66, `docs/chain/entry.md`, "Task feeds"), each
feed's profile in `feed_profiles`. `version` is the schema version of a file of the format.

- **`branch`** — the project's main branch, `main` by default: one for the hub's checkout and the project's folders on
  its machines. It is a fact about the repository like `repo`, not a choice that could be shared. Written by the page,
  the wizard (the checkout's current branch) and hand; a save on the page moves the checkout and the machines' folders
  first, and is refused while the project has a task in hand (`branch.busy`); a hand edit of the config moves nothing
  (`docs/machines/landings.md`, "The main branch on machines").

### Outside the settings tables

| What | Where | Levels | Note |
| --- | --- | --- | --- |
| a package's `default`, `settings` | `state/packages.json` `packages.<name>` | G | the package level: projects start from it |
| a project's `on`, `off`, `settings` | `state/packages.json` `projects.<id>` | P | over the package's, `settings` by variable |
| a machine's server command and arguments | `project_machines.settings` | machine | over the catalog's (`levels.md`, "A machine in a project") |
| a task's run: provider, model, effort, machines | the state database, `task_runs` | T | over the project's `provider` and `models.<provider>`; set on the task card and by the tasks server (BTN-983, `docs/sessions/models.md`); `machines` pins the task to machines of the pool (BTN-1623, `docs/machines/pool.md`, "A task pinned to machines") |
| `Break \| compaction`, `Break \| handoff` | tracker label | T | the task level of `stats.checkpointTokens` (`levels.md`, "Labels as values") |
| other excluded labels | tracker label | T | matched by `chain.excludedLabels`, a G/P setting |
| required labels | tracker label | T | matched by `chain.requiredLabels` |
| `Question`/`Вопрос` | tracker label | T | `QUESTION_LABELS`: the card's mark and the prompts' wording; it changes neither the order nor the launch |
| Tally's `evenKeelUrl`, `signs`, `classify`, `reportsSince`, `prices`, `unpriced` | `tally/tally.config.json` | — | the collector's own settings (`docs/tally.md`) |

### Not settings

- **Credentials** — never in a draft or the settings tables: the trackers' and the CI's are profiles in the state
  database, Even Keel's own secrets are lines of `.env`, both outside git (invariant 3; `levels.md`, "Credentials").
- **The address** — `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT`, `EVEN_KEEL_MCP_PORT`: read before anything else, from the
  environment.
- **Locations and binaries** — `EVEN_KEEL_CONFIG` (only the file imported at the first start), `EVEN_KEEL_STATE_DIR`,
  `EVEN_KEEL_ACCOUNTS_DIR`, `EVEN_KEEL_CODEX_ACCOUNTS_DIR`, `EVEN_KEEL_CLAUDE_BIN`, `EVEN_KEEL_CODEX_BIN`: needed before
  the storage is open (the database lives in the state folder), so they stay in the environment. So do
  `EVEN_KEEL_CPU_PROFILE`, a diagnostic of the start (`docs/service/start.md`, "Diagnostics"), and `EVEN_KEEL_MACHINE=1`,
  set by the Compose templates' `machine` service: an installation that joined no hub waits for the join instead of
  starting a hub (BTN-1440, `docs/machines/elsewhere.md`, "Machines elsewhere").
- **Tally's connection** — `TALLY_DB_*`, `TALLY_*_USER`, `TALLY_LLM_URL`, `TALLY_LLM_MODEL`, `TALLY_CONFIG`,
  `TALLY_LLM_DICTATION_MODEL` (the chat microphone's model, BTN-1391; read by the service on each recording),
  `EVEN_KEEL_URL`: the collector's, which can run against an external Postgres. Tally's own file stays its own; its
  prices are reference data, already loaded into its `model_prices` table.
- **State that sits among settings** — `updates.dismissed` (the version whose toast was closed) and `notices.dismissed`
  (a banner's "Got it": its id to the stamp of what it said, BTN-759), both in `service_state`; a package's catalog
  entry, installs and the task pins of `state/packages.json`; the account pool's sign-ins in `state/account.json`.
- **A tracker connection** is a tracker profile (BTN-66): the project's `tracker` with the tracker's project and its
  profile, and each feed's, say where its tasks come from.
