# Schema steps: the older steps

State steps 1–50 and the file schema versions. The rules of a step, and what an entry leaves out, are in [`steps.md`](steps.md#the-rules); the steps from 51 on are there too.

## State steps 1–50

- **Step 3**: the tables of the SQLite versions in Postgres.
- **Step 4** (BTN-199): `projects`, `setting_definitions`, `setting_values` and `service_state`. The rows of `chain_flags` (`unattended`, `trimTools`) become setting rows, with their two definitions only when it had rows, and `chain_flags` is dropped.
- **Step 5** (BTN-200): `tracker_profiles` and `projects.profile_id`.
- **Step 6** (BTN-209): `changelog_versions`.
- **Step 7**: `changelog_versions.spend`.
- **Step 8** (BTN-205): `chain_lists` may hold the list `reviews`, the pull requests of PR mode (`docs/chain/pr-mode.md`).
- **Step 9** (BTN-207): the `color` definition. Each project at a position under 8 gets the color of its position (`position + 1`), so nothing is repainted (`docs/settings.md`).
- **Step 10** (BTN-245): `chain_lists` may hold the list `shelved`, tasks that left the chain for an inactive status after their session's turn (`docs/chain/state.md`).
- **Step 11** (BTN-271): `projects.key` is no longer unique.
- **Step 12** (BTN-66): `tracker_profiles.rules`, `projects.feeds`, `feed_profiles`, and the profile and status of `closed_tasks`.
- **Step 13** (BTN-345), with file schema v13: the tracker is a project's own. A project without a `tracker` row gets the shared row's value, or `huly` without one, and the shared row goes. The SQLite and v0.1 imports pass through the step; an imported config gets the same from `trackersOwned`.
- **Step 14** (BTN-418): `key_organizations`.
- **Step 15** (BTN-475): `tracker_profiles.mcp_oauth`.
- **Step 16** (BTN-461), with file schema v17: each stored `modelPrompts` model key becomes `* | <model>`, keeping the JSON entry order and the setting's writer.
- **Step 17** (BTN-543): `global_accounts`, the explicit registrations of the global Claude and Codex folders (`openAccountHomes`). On an existing database only, the step sets `accounts.adoptLegacy` in `service_state`: the runner gives the version from before the whole migration as the transaction-local `even_keel.migration_from`, so a fresh database passing through all steps stays fresh. Importing old state files, or an old account ledger without chain history, sets the same marker. The first account start consumes it in the transaction that registers the global folders present then.
- **Step 18** (BTN-577): no table change. It marks the new `LimitHold.overage` JSON in `chains` (the kept session snapshot and the successful-stop marker, so a paid usage stop survives a restart), so that older code cannot drop the wait and relaunch. Sample: a paid hold with an unknown reset. Test `database-overage.test.ts`.
- **Step 19** (BTN-541), with file schema v20: Protection's one tracker group `deleteTracker` becomes a group per tracker (`deleteHuly`, `deleteGithub`, `deleteGitlab`, `deleteLinear`, `deleteJira`); a disabled `deleteTracker` disables all five, shared and per project. The step rewrites the `protection` rows, the file migration is `trackerGroupsOwned`. Sample: a shared and a project row with the old group. Test `database-protection.test.ts`.
- **Step 20** (BTN-603), with file schema v21: the default of `cli.<provider>` became `system`. An existing database (`even_keel.migration_from` above 0) gets a shared `checked` row for each provider it left out, with the `cli` definition if it had none, so its sessions stay on the checked copy. File migration `cliChecked`. Test `database-cli.test.ts`.
- **Step 21** (BTN-610), with file schema v22: Claude's Agent SDK runs only on the checked CLI. A shared `execution.claude` row `"sdk"` writes the shared `cli.claude` row `"checked"` (by `service`) over `"system"` or where the default applied, with the `cli` definition if it had none. File migration `sdkChecked`. Test `database-sdk-cli.test.ts`.
- **Step 22** (BTN-558): `mailbox.reason`, why a message came back: `asked`, `gone` or `closed` (the task was over for the chain). Older rows read as `asked`. Test `database-mail-reason.test.ts`.
- **Step 23** (BTN-553), with file schema v23: a feed keeps its own chain rules (`chain` in its entry of `projects.feeds`) and the project's no longer reach its tasks. So that a feed takes the same tasks, the step copies a project's own rule rows (the four chain rules and the two milestone rules) into each of its feeds without a `chain`. File migration `feedsRuled`. Test `database-feed-rules.test.ts`.
- **Step 24** (BTN-554), with file schema v24: `tracker_profiles.moves`, the profile's status moves as JSON (`{}` on older rows: nothing moves). A project's own are its `statusMoves` row, a feed's the `moves` of its entry. Test `database-profile-moves.test.ts`.
- **Step 25** (BTN-631): `account_limits`. Test `database-account-limits.test.ts`.
- **Step 26** (BTN-689): `merge_closes`. Test `database-merge-closes.test.ts`.
- **Step 27** (EKR-83), with file schema v26: Claude background launches always trust the checkout; the `trustClaude` values and their definition go. Test `trust-migration.test.ts`.
- **Step 28** (BTN-758), with file schema v28: `Manual` is only the default excluded label. On an upgrade only, every `chain.excludedLabels` set (shared, a project's, a profile's, a feed's) gets `Manual` and `Вручную`, and the shared `["Manual", "Вручную"]` is written where none was. File migration `manualKept`. Test `database-manual-labels.test.ts`.
- **Step 29** (BTN-350): `event_log`. Test `database-event-log.test.ts`.
- **Step 30** (BTN-767): the built-in tracker's tables (`builtin_*`, [the table](database.md#the-tables)). `config-export` leaves them out; a backup carries them. Test `database-builtin.test.ts`; how the tracker uses them is in `docs/trackers.md`.
- **Step 31** (BTN-774): `builtin_comments.model`. Test `database-comment-model.test.ts`.
- **Step 32** (BTN-773): `builtin_files`, a built-in task's attachments; the bytes are in `files/<sha256>` next to `pgdata/` (`filesDirOf`), swept of bytes no record points at (`docs/trackers.md`, "Attachments"). Test `database-files.test.ts`, with a backup carrying the bytes.
- **Step 33** (BTN-206), with file schema v29: the project-only `testProject`, `false` by default. The step registers its definition on an existing database; a fresh one gets it from the definition mirror. Test `database-test-project.test.ts`, with a repeated run.
- **Step 34** (BTN-814): `rare_events`. Test `database-rare-events.test.ts`.
- **Step 35** (BTN-860): `key_spends`. Test `database-key-spends.test.ts`.
- **Step 36** (BTN-830): `tracker_profiles.disabled`, `false` on older rows (`docs/trackers.md`, "Profiles"). Test `database-profile-disabled.test.ts`.
- **Step 37** (BTN-868): `management_keys`; `config-export` leaves them out. Test `database-management-keys.test.ts`.
- **Step 38** (BTN-880): `browser_hotkeys`. Test `database-browser-hotkeys.test.ts`.
- **Step 39** (BTN-896): `task_retries`. Test `database-task-retries.test.ts`, with the copy of the data keeping the identity counters; it reads the journal by SQL, since `TaskRetries` reads the newest schema.
- **Step 40** (BTN-905): `task_retries.started`. Test `database-task-markers.test.ts`.
- **Step 41** (BTN-901): `account_settings`. Test `database-account-settings.test.ts`.
- **Step 42** (BTN-911): `builtin_tasks.estimate`. Test `database-builtin-estimate.test.ts`. The tests of steps 30–32 read their samples through today's `BuiltinStore`: the step 30 one first brings its sample up through the later steps; the store's single-row reads leave `estimate` out, so the samples of 31 and 32 read as they are.
- **Step 43** (BTN-925): `left_folders`. Test `database-left-folders.test.ts`.
- **Step 44** (BTN-946): `context_windows` and `session_windows`. Test `database-context-windows.test.ts`, with the limits of both tables.
- **Step 45** (BTN-918): `badge_translations` and `badge_translation_spend`; how the badge uses them is in `docs/badge.md`. Test `database-badge-translations.test.ts`.
- **Step 46** (BTN-971), with file schema v36: `chain.excludedLabels` is empty by default, without `Manual`. On an upgrade only, the step writes the shared `["Manual"]` (by `service`) where no shared list was kept, with the definition if it had none; a list kept, an empty one too, stays. File migration `manualDefaultKept`. The built-in tracker needs nothing: a `Manual` on its tasks is a `builtin_labels` row. Test `database-default-label.test.ts`.
- **Step 47** (BTN-983), with file schema v37: `task_runs` and `run_label_imports`; the setting `modelLabels` goes. The step marks in `run_label_imports` every project whose `modelLabels` was on (its own row or the shared one), then deletes the rows and the definition. The labels are moved later by the service, which needs the tracker (`TaskRuns.importLabels`). File migration `runLabelsDropped`. Test `database-task-runs.test.ts`, with the store.
- **Step 48** (BTN-984), with file schema v38: OpenCode's model is kept per provider it signs in to. Each `models` row qualified `opencode` (shared and per project) moves to the slot `opencode/<prefix>` its model's prefix names (`openai`, `anthropic`, `openrouter`, `github-copilot`, `opencode-go`, `opencode`), any other to `opencode/opencode`. File migration `openCodeModelsSlotted`, which keeps a slot already filled. Test `database-model-slots.test.ts`.
- **Step 49** (BTN-1073): `tracker_exports` and `tracker_export_tasks`, a built-in project's copy into another tracker; `forgetProjectRows` drops them with the project (`docs/trackers.md`, "The copy into another tracker"). Test `database-exports.test.ts`.
- **Step 50** (BTN-1076): `tracker_exports.source_key`. The switch (BTN-1074) gives the project the target's key, so without it the old ids `<source_key>-<number>` would be lost; Tally links them to the new keys by it (`docs/tally/cost.md`, "The built-in tracker"). The step fills it for copies of projects still on the built-in tracker; one already switched has lost its old key and stays null. Test `database-export-source.test.ts`.

## File schema versions

A version with a state step is changed by both: the step in the database, the named migration in an imported config. A version with no step needs none: its setting's definition is mirrored from the registry at the start, or the chain state is stored whole. "Only a restamp" means older files take the new number and an omitted field keeps the old behaviour. Each version has its sample `test/fixtures/schema-v<N>/`. Versions 2–12 are described in the comments of `src/storage/migrations.ts`.

- **v13** — with step 13.
- **v14** (BTN-434): package settings become user overrides, the defaults read from each install.
- **v15**, **v16**: Protection settings, then OpenCode's Protection patterns; omitted fields keep the built-in defaults, an empty custom list.
- **v17** — with step 16.
- **v18** (BTN-547): the optional `reason` (`postpone` or `skip`) and `blockers` of a `shelved` entry, and the handover causes `unblocked` and `unskipped`. Only a restamp: an entry without a reason keeps the inactive-status behaviour, and the `chain_lists` JSON and `handoffs.reason` text take the new values as they are.
- **v19** (BTN-394): the nullable `autoCompactWindow`, shared and per project, and the optional launch `settings` of SDK session records. Only a restamp: an omitted window keeps the account's.
- **v20** — with step 19; **v21** — step 20; **v22** — step 21; **v23** — step 23; **v24** — step 24.
- **v25**: the optional project consent `trustClaude`, false when omitted; **v26** — with step 27, which removed it again.
- **v27** (BTN-759): the optional `notices`, Even Keel's and a project's. Only a restamp.
- **v28** — with step 28; **v29** — step 33.
- **v30** (BTN-810): the nullable `codexAutoCompactWindow`, shared and per project, and a Codex session record's optional `contextWindow` (`state/codex/sessions/`). Only a restamp: omitted keeps the model's own window.
- **v31** (BTN-856): the same for OpenCode, `openCodeAutoCompactWindow` and the records of `state/opencode/`.
- **v32** (BTN-846): the boolean `ci.rerunFailed`, shared and per project, `true` when absent, and the optional `rerun` of a project's CI state (`ci[<project>].rerun`: the red commit whose failed jobs were rerun, when, and their runs). Only a restamp.
- **v33** (BTN-829): the optional `afterGreenRun` of a project's CI state: the commit and start of the last run of `commands.afterGreen` and, once it ended, when and how (`done`, `failed` with the command and code, or `skipped` with the reason as a notice). Only a restamp: no record means no run seen yet.
- **v34** (BTN-792): a project's optional `milestoneOrder`, a list of milestone labels; absent or empty is the automatic order.
- **v35** (BTN-915): a project's optional `badge`, `{ on, url, slug, fields }` or `null` (`docs/badge.md`).
- **v36** — with step 46; **v37** — step 47; **v38** — step 48.
- **v39** (BTN-1131): a package's and an install's optional `scripts` in `state/packages.json`; omitted, npm runs no install scripts.
- **v40** (EKR-135): the optional `conflict` of a carry session (`ci[<project>].carry.conflict`: the conflicted files, each with its conflict lines or `null` for one deleted on one side), so the waiting carry's panel keeps them through a restart; omitted shows dashes. Made on `release/v0.3` while `dev` was at v39 too.
- **v41** (BTN-1354), with state step 68: the shared `context.window` setting goes; the warning and danger thresholds stay.
