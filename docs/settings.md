# Settings by level

The research of BTN-145 (2026-10-18): every setting Even Keel has, the levels it is set at, how they override each other,
and the schema of the settings tables the storage move into one database (BTN-147) builds on. The implementation is
split into BTN-186 (the registry over the current file), BTN-187 (the missing levels) and BTN-146 (effort, the first new
setting on three levels); the "Mismatches" and "Decisions" sections are what they follow.

## Levels

There are three levels and a default, narrowest wins: **task** → **project** → **Even Keel** → the built-in default.

- **Even Keel** (shared) — the rows of `setting_values` without a project (the top level of the config's format),
  written by the page `/settings`.
- **Project** — the project's rows (its entry in `projects[]` of the format), written by the project's settings panel. A project's own value
  goes over the shared one; a value left out means "as shared".
- **Task** — only through a tracker label. Labels are the tracker's, not Even Keel's: nothing of the task level is
  stored, it is read off `Task.labels` on every launch.

Four chain rules have a level between the project and Even Keel (BTN-66): the **tracker profile** the project runs on,
or for a task of one of its feeds, the feed's profile. `chain.active`, `chain.terminal`, `chain.requiredLabels` and
`chain.excludedLabels` go project → profile → Even Keel, key by key; the milestone rules have no profile level. They
are kept in the profile (`tracker_profiles.rules`, only the keys set), edited in a group per tracker profile on
`/settings`, and stay out of `config-export` with the profiles (`docs/trackers.md`, "Profiles"). A project's save
writes a rule key only where its value differs from what the project inherits — the profile's over the shared one
(BTN-334, `withProjectForm`): a value equal to the profile's stays inherited, so a later change of the profile reaches
the project. The page edits the rules by status and by label, one form on the three levels (`docs/web.md`).

Some settings are maps whose entries override one by one: `models`, `accounts` and `execution` by provider. A project's
`models.codex` replaces only the shared `models.codex`; the shared `models.claude` still applies to it.

## Inventory

As of 2026-10-20 (schema version 9, database step 9; BTN-187 widened levels, which needs no step). "Levels": G — Even Keel, P — project, T — task label. "Written
by": page, hand (a file through `config-import`, `docs/storage.md`), service. Every key applies at once, without a
restart of the service (BTN-130). The keys are those of the config's format, which the database's rows keep (BTN-199).

### The settings (`setting_values`)

| Key | Levels | Merge | Written by | Default |
| --- | --- | --- | --- | --- |
| `parallel` | G | — | page, hand | 1 |
| `tracker` | P | — (a project's own since BTN-345: every writer stores it, so no later default moves a project) | page, hand | `github`, only for a project of a hand-written file that names none |
| `brief` | G, P | P over G; `null` — auto: on exactly when no enabled package of the project brings its tracker's MCP server (`bringsServer`, BTN-225) | page, hand | `null` |
| `chain.active`, `chain.terminal` | G, profile, P | each key P over the profile's over G; `null` — back to the status categories | page, hand (not the profile's) | `null` |
| `chain.requiredLabels` | G, profile, P | each key P over the profile's over G, the list replaced whole | page, hand (not the profile's) | `[]` |
| `chain.excludedLabels` | G, profile, P | each key P over the profile's over G, the list replaced whole; `MANUAL_LABELS` are excluded on top of any list (BTN-187) | page, hand (not the profile's) | `[]` |
| `chain.requiredMilestones`, `chain.excludedMilestones` | G, P | each key P over G, the list replaced whole; one milestone in both is `config.milestoneBoth`; projects on one tracker place must split it (`config.trackerProjectShared`, BTN-172, `docs/chain.md`) | page, hand | `[]` |
| `provider` | G, P | P over G | page, hand, service (the "Even Keel" role, `saveActive`) | `claude` |
| `models.<provider>` | G, P | by provider, P over G | page, hand | `{ claude: 'opus' }` |
| `accounts.<provider>` | G, P | by provider, P over G | page, hand, service (`saveActive`) | `{ claude: 'global', codex: 'codex' }` |
| `execution.<provider>` | G | — | page, hand | the first mode of each provider: `claude` — `auto` (`bg`, `sdk`; the transport of its sessions, BTN-353), `codex` — `sandbox` (`bypass`) |
| `cli.<provider>` | G | — | page, hand | `checked` for every provider: `claude`, `codex`, and `opencode` and `copilot` since BTN-347 (BTN-250, `docs/sessions.md`) |
| `modelLabels` | G, P | P over G | page, hand | false |
| `modelPrompts.<model>` | G | — | page, hand | `{}` |
| `language` | G | — | page, hand | `null` (the browser's) |
| `promptLanguage` | G, P | P over G | page, hand | `language`, else `en` |
| `hiddenSkills` | G | — | page, hand | `DEFAULT_HIDDEN_SKILLS` |
| `cacheTtl` | G, P | P over G; a project's `null` is its own value (the CLI's) | page, hand | `null` (the CLI's) |
| `keepWarm` | G | — whole hours 0–24 since a waiting chain session's last answer that its cache is kept warm (BTN-437, `docs/chain.md`); 0 — off | page, hand | 0, until its live check |
| `allowedHosts` | G | — | page, hand | `[]` |
| `context.window`, `.warn`, `.danger` | G | — `window` only stands in for a session whose agent gave no window of its own (BTN-187, `docs/sessions.md`) | page, hand | 600000, 50, 80 |
| `stats.compare.*`, `stats.moves`, `stats.otherBelow` | G | — | page, hand | `DEFAULT_COMPARE`, `{}`, 0 |
| `stats.checkpointTokens` | G, P | P over G (pins the threshold, calibration off; a project's `null` calibrates it) | page, hand | `null` (calibrated per project) |
| `stats.checkpointShares.first`, `.late`, `.hard` | G, P | each key P over G; whole percents 1–100, `first < late < hard` checked on what each level ends up with (`config.checkpointShareOrder`); ignored while `stats.checkpointTokens` pins the threshold; for a Claude session `late` and `hard` are also kept before its compaction, so a share above that point does nothing (BTN-261, BTN-377, `docs/sessions.md`) | page (the project's panel sets the three together), hand | 72, 85, 95 |
| `tally` | G | — (`off`, `local`, `server`) | page (the setup's stats step and Settings → Stats, sent at once, `stats/tally`), hand, service (the mode an older install ran on, at startup) | `null` — not chosen, nothing collected (`docs/stats.md`) |
| `updates.check`, `updates.notify` | G | — | page (the check also in the first run's setup, BTN-310), hand, service (`muteUpdates`) | true, true; the check is held during the first run (`docs/web.md`) |
| `unattended` | G | — | page (a switch on `/settings`, sent at once, `chain/unattended`), hand | false |
| `trimTools` | G | — | page (a switch on `/settings`, `chain/trim`), hand | true |
| `slot` | P | — | page, hand | none (a worktree per task) |
| `color` | P | — | page (with the repository), hand, the wizard (the first free one) | none: the first slot of 1–8 no project has as its own, in config order (`colorsOf`, `src/projects/colors.ts`); none left — `--series-other`. Database step 9 wrote the slots of the positions (BTN-207) |
| `branch` | P | — | page, hand | `main` |
| `changelog` | P | — | page, hand | `CHANGELOG.md` (a path relative to the repository's root; absolute or `..` is `config.changelogPath`; BTN-209, `docs/sessions.md`) |
| `standards` | P | — | page, hand | `[]` — the project's standards, `{ doc, files, except, shots }` each: a document inside the repository, at least one mask, a document once, else `config.standards` (BTN-359, `docs/sessions.md`, "Project standards") |
| `prompt` | G, P | adds up, not over (BTN-338): a new session gets G, then P (`withPrompts`); a project's empty one leaves G in place. `ProjectSettings.prompt` is only the project's own row, G is `EvenKeelConfig.prompt` | page, hand | `null` on both |
| `commands.beforeStart`, `.check`, `.afterGreen` | P | each key on its own | page, hand | `[]` |
| `ci.guard`, `.kinds`, `.waitMinutes`, `.recheckMain`, `.fixTask` | G, P | each key on its own, P over G over `DEFAULT_CI`; a project's `waitMinutes: null` is its own value | page, hand | `DEFAULT_CI` |
| `fillMilestone` | G, P | P over G | page, hand | false |
| `mergeInto` | P | — the key of a main project, checked against the projects (`config.mergeInto`); the page's save also refuses a checkout of another repository (`config.mergeIntoForeign`, BTN-285) | page, hand | `null` — a main project (BTN-172, `docs/chain.md`, "Carrying a release project forward") |
| `carryAgent` | P | — read only for a release project; unattended mode acts as if it were on | page (under "Merges into", shown once that names a project), hand | false — a carry conflict waits for "Resolve with the agent" (BTN-370, `docs/chain.md`, "The carry session") |
| `pullRequests` | P | — | page, hand | false (PR mode, BTN-205, `docs/chain.md`) |
| `intakeLabel` | P | — | page (the Tracker tab, not for a GitHub tracker), hand | `null` — no GitHub issues are taken in (BTN-262, `docs/trackers.md`, "Taking GitHub issues in") |
| `remoteProfiles` | P | — | page, hand | `{}` — the GitHub, GitLab and Forgejo profile ids the remotes' CI and pull requests take; a missing or unfit one is the automatic choice (BTN-231, `docs/ci.md`) |

Project record fields, not settings: `id` (written by the service for an entry without one, `withIds`), `key`, `name`,
`repo`, the tracker's project (`github`, `huly`, `linear` by `TrackerAdapter.projectKey`): the table `projects`; the
extra task feeds (`feeds`, BTN-66, `docs/chain.md`, "Task feeds"): a JSON column of `projects`, each feed's profile in
`feed_profiles`. `version` is the
schema version of a file of the format.

### Outside the settings tables

| What | Where | Levels | Note |
| --- | --- | --- | --- |
| a package's `default`, `settings` | `state/packages.json` `packages.<name>` | G | the package level: projects start from it |
| a project's `on`, `off`, `settings` | `state/packages.json` `projects.<id>` | P | over the package's, `settings` by variable |
| the run label `<Provider> \| <model>`, bare `<Provider>` | tracker label | T | sets `provider` and `models.<provider>`, read only while `modelLabels` is on |
| `Manual`/`Вручную` | tracker label | T | `MANUAL_LABELS`, built in: the chain skips the task whatever `chain.excludedLabels` holds |
| other excluded labels | tracker label | T | matched by `chain.excludedLabels`, a G/P setting |
| required labels | tracker label | T | matched by `chain.requiredLabels` |
| `Question`/`Вопрос` | tracker label | T | `QUESTION_LABELS`: the card's mark and the prompts' wording; it changes neither the order nor the launch |
| Tally's `evenKeelUrl`, `signs`, `classify`, `reportsSince`, `prices`, `unpriced` | `tally/tally.config.json` | — | the collector's own settings (`tally/CLAUDE.md`) |

### Not settings

- **Credentials** — never in a draft or the settings tables. The trackers' (`HULY_*`, `GITHUB_TOKEN`, `LINEAR_TOKEN`)
  are profiles in the state database (BTN-200, `docs/trackers.md`, "Profiles"), and so is Forgejo's
  (`FORGEJO_URL`, `FORGEJO_TOKEN`, BTN-201); `EVEN_KEEL_TOKEN`, Tally's own Postgres and classifier stay in `.env`, written from the `/settings` tab each belongs to
  (BTN-131, BTN-355, "Credentials" below). Both are outside git (invariant 3).
- **The address** — `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT`, `EVEN_KEEL_MCP_PORT`: read before anything else, from the
  environment.
- **Locations and binaries** — `EVEN_KEEL_CONFIG` (since BTN-199 only the file imported at the first start),
  `EVEN_KEEL_STATE_DIR`, `EVEN_KEEL_ACCOUNTS_DIR`,
  `EVEN_KEEL_CODEX_ACCOUNTS_DIR`, `EVEN_KEEL_CLAUDE_BIN`, `EVEN_KEEL_CODEX_BIN`: needed before the storage is open (the
  database lives in the state folder), so they stay in the environment.
- **Tally's connection** — `TALLY_DB_*`, `TALLY_*_USER`, `TALLY_LLM_URL`, `TALLY_LLM_MODEL`, `TALLY_CONFIG`,
  `EVEN_KEEL_URL`: the collector's, which can run against an external Postgres. Tally's own file stays its own; its
  prices are reference data, already loaded into its `model_prices` table.
- **State that sits among settings** — `updates.dismissed` (the service writes it when a toast is closed; `service_state`
  since BTN-199, a key of the config before), a package's
  catalog entry, installs and the task pins of `state/packages.json`, the account pool's sign-ins in `state/account.json`.
- **Project record fields** — `id`, `key`, `name`, `repo`, `branch`, the tracker's project. `branch` is a fact about the
  repository like `repo`, not a choice that could be shared. A tracker connection is a tracker profile (BTN-66): the
  project's `tracker` with the tracker's project and its profile, and each feed's, say where its tasks come from.

## Mismatches

What sits at a level it should not, or misses one it should have. BTN-187 fixed the first group (2026-10-20); the
entries stay as the reason for the levels.

- `ci.*` was project-only: five projects that want `fixTask` set it five times. Now a shared level, each key over its own.
- `promptLanguage` was shared only, though projects differ in the language of their tasks. Now on both levels.
- `stats.checkpointTokens` pinned the threshold for every project while the calibration it switches off is per project.
  Now on both levels; the key stays under `stats`.
- `cacheTtl` lacked the project level, `fillMilestone` the shared one. Both now on both levels.
- `context.window` is a property of the model, not of Even Keel. The window now comes from the agent (`/context` of
  Claude, the rollout of Codex, `docs/sessions.md`), and the setting is only the fallback.
- `chain.excludedLabels` carried `Manual`/`Вручную` only as its default, and a list is replaced whole: a project, or a
  hand-written shared list, with its own excluded labels silently ran the manual tasks. The manual labels are now
  built in (`MANUAL_LABELS`, like `QUESTION_LABELS`) and the default list is empty.
- `unattended` and `trimTools` were user settings kept with the chain state (`chain_flags` of the database since BTN-147,
  `state/chain.json` before), and `updates.dismissed` was state kept in the config. Each moved to its own side with the
  settings (BTN-199): the switches are Even Keel rows, the closed version is in `service_state`.
- The model's project level, which the task's text missed, exists since BTN-173 (`models` in the project entry).

Levels that stay as they are: `parallel`, `execution` (the Codex sandbox does not start under the service for any project, so
there a command runs only by escalation or with `bypass`, `docs/sessions.md`), `cli` (an account folder has one daemon, on one
version, whatever project its sessions are for), `modelPrompts`, `hiddenSkills`, `language`, `allowedHosts`, `stats.*` besides the threshold,
`updates.*` — Even Keel only; `commands.*`, `slot` — project only. `prompt` was project only until BTN-338 gave it an Even
Keel level too: one instruction for every project and agent, which no agent's own global rules file (`~/.claude/CLAUDE.md`,
Codex's `AGENTS.md`) carries to the others.

A task level makes sense only for what runs the session: `provider`, `models` (the run label), `effort` (BTN-146). Not
for anything about the repository (`commands`, `ci`, `slot`, the tracker), the chain (`brief`, `chain.*`, `parallel`) or
the page; and not for `prompt`: the task's description is its prompt.

## Proposed schema

Two tables, as the user proposed, with one change of emphasis: the code is the source of the definitions, the database
holds the values. A validator (the branch pattern, `checkRules`, a placeholder in a model prompt) cannot live in SQL, and
defaults change with releases, so a definitions table authored in the database would need a migration every release.
The table still exists: the service writes it from the code's registry on every start, in one transaction, so values
have a foreign key and SQL readers (Tally, a support query) see what a key means.

```sql
CREATE TABLE setting_definitions (
  key           TEXT PRIMARY KEY,   -- the JSON path of today's file: 'ci.fixTask', 'models', 'chain.active'
  kind          TEXT NOT NULL,      -- boolean | integer | number | string | enum | list | json
  spec          TEXT NOT NULL,      -- JSON: {"min":1}, {"values":["5m","1h"]}, {"of":"string"}, {"nullable":true}
  default_value TEXT,               -- JSON; NULL when the code computes it (promptLanguage from language)
  scopes        TEXT NOT NULL,      -- 'global' | 'project' | 'global,project'
  qualifier     TEXT,               -- NULL | 'provider' | 'model' | 'package'
  task_label    TEXT                -- NULL | 'run' | 'effort': the label parser that feeds the task level
);

CREATE TABLE setting_values (
  key        TEXT NOT NULL REFERENCES setting_definitions(key),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- NULL: Even Keel itself
  qualifier  TEXT NOT NULL DEFAULT '',                         -- a provider, a model or a package; '' when none
  value      TEXT NOT NULL,                                    -- JSON; JSON null is a value, not inheritance
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL                                     -- page | service | import | hand
);
CREATE UNIQUE INDEX setting_values_target ON setting_values (key, COALESCE(project_id, ''), qualifier);
```

The SQL is for PGlite, the engine since BTN-198; the expression index stands in for a primary key over a nullable
column. Step 4 of the database makes these tables (BTN-199); `spec` is written as `{}` for now, since the checks are
code (`mirrorDefinitions`).

- **A setting is a leaf replaced whole.** A nested object of today's file becomes one key per part wherever the parts
  merge or default on their own — all of them do now: `chain.*`, `ci.*`, `commands.*`, `context.*`, `stats.compare.*`,
  `updates.*`. A list (`kinds`, `hiddenSkills`, the labels, a command list) is one value, replaced whole, as now.
- **A map whose entries merge across levels gets a qualifier**: `models`, `accounts` and `execution` by provider,
  a package's switch and variables by package. `context.window` got none: BTN-187 takes the window from the agent and
  leaves the setting as the fallback. A map with free keys that lives at
  one level only (`modelPrompts`, `stats.moves`) is one `json` value.
- **No row is inheritance; JSON `null` is a value.** `chain.active: null` (back to the categories over a shared list),
  `ci.waitMinutes: null`, `cacheTtl: null` are rows. Going back to the shared value on the page (the "own" chip) deletes the row; nothing stores "inherit".
- **Packages**: `packages.enabled` (qualifier: the package) with the catalog's `default` as its Even Keel value and a
  project's `on`/`off` as its project rows; `packages.setting` (qualifier `<package>/<variable>`) with the package's
  values as Even Keel rows and a project's differing ones as project rows. The catalog, installs and pins stay state.
- **`unattended`, `trimTools`** become Even Keel rows (step 4 moves the rows of `chain_flags`); `updates.dismissed`
  goes to state (`service_state`, taken out of the file at the import).
- **Project records** are a table of their own (`projects`: `id`, `key`, `name`, `repo`, `branch`,
  `tracker_projects`, `position` for the order of the file) — BTN-199.

## Reading and writing

One place reads and one place writes, so that BTN-199 swapped the source and not the callers. Since BTN-186 this is the
code in `src/settings/`; since BTN-199 the source is the database:

- `registry.ts` — `DEFINITIONS` (key, kind, scopes, qualifier, task label, the `EvenKeelConfig` fields it lands in,
  default, check), `OBJECTS` (the nested objects and their unknown keys), `LABEL_PARSERS`;
  `defaults.ts` — the built-in values.
- `file.ts` — `fileRows` (the format → project records and unchecked rows, the shape checked), `fileOf` (back: records
  and rows → the format), `withRows` (changes → the format's JSON paths, an unset dropping the objects it empties).
- `store.ts` — the tables: `mirrorDefinitions` (the registry → `setting_definitions`, every start), `readSettings` (one
  statement → records and rows), `saveSettings` (whole replace in one statement), `putSettings` (upsert only).
- `import.ts` — `configOfFile` (a file of any schema → records and rows, `updates.dismissed` taken out), `prepareSettings`
  (the import at the first start), `exportConfig`, `importConfig` (`docs/storage.md`).
- `src/config-store.ts` — `ConfigStore`, the service's copy: the contents in memory, `current` the last valid parse, a
  save written behind (`Writes`), and every 2 s a look at the database that applies a change written by someone else
  (`config-import`) at once, as the watch of the file did.
- `resolve.ts` — `SettingRow`, `ProjectRecord`, `checkRows`, `resolve` (`shared`, each project's `own` and `values`, the
  task's labels optional), `inherit` (the one merge rule, also behind `runSettings`).
- `changes.ts` — `RowChange` and `changesOf`: a form as `FormValue`s by group, a changed group's values set or unset
  against what having no row gives.

`parseConfig` is `fileRows` + `checkRows` + `resolve` + the cross-setting checks; the forms' writers (`withSharedForm`,
`withProjectForm`, `withProjectSettings`, `withUpdates`, `withChainSwitches`, `withRunAccount`) map their fields to
`FormValue`s and write through `withRows` on the format (`ConfigStore.raw()`), which the store turns back into rows. `src/settings/golden/` holds the output of `parseConfig` from before the registry for every frozen
sample, the example config and `full.fixture.ts`; a difference there is a change of behaviour.

The service does not read task labels through `resolve` yet: launches still go through `runChoice`, which also falls
back when the pool has no account for the label's provider.

The design it follows:

```
a file (import) ──── fileRows ─────┐
                                    ├─► project records + rows ── check each row by the registry ── resolve ──► EvenKeelConfig
database ─────────── readSettings ──┘                                                    ▲
                                                                  task labels ── label parsers (task level, at launch)
```

- `fileRows(raw)` turns today's file into project records and rows — it is also the import of v0.1 files into the
  database, tested against the frozen samples in `test/fixtures/`.
- `resolve` gives each project's values: the task's label value, the project's row, the Even Keel row, the default — per
  qualifier for qualified keys. Cross-setting checks run after it, where `parseConfig` runs them now (`checkRules` on
  the merged rules, `promptLanguage` falling back to `language`). Its output is today's `EvenKeelConfig`, so `runSettings`,
  the dispatcher and the page do not change.
- A definition has no `apply`: since BTN-130 every key applies at once, so there is no restart key to mark.
- The unit of change of a form is its group: a field of the form (`ci`, `context`, `stats`, `updates` are written whole),
  one rule of `chain`, one provider of the shared `models`, `accounts`, `execution`.
- A save of the page becomes a diff of rows (`set`, `unset`) between the form and its base; the file writer turns the
  diff back into JSON paths (replacing `withSharedForm` and `withProjectSettings`), the database writer into an upsert and
  a delete. A key the form did not change keeps the file's spelling, as now.
- Renaming or removing a setting stays what it is now: a new `SCHEMA_VERSION` and a migration step that moves or drops its
  rows.

## Credentials (BTN-131)

There is no tab of credentials (BTN-355): each sits where its use is set. The trackers' profiles (rows and the "Add
profile" dialog, BTN-200, `docs/trackers.md`; Forgejo's for the CI among them, BTN-201) are the "Trackers and CI" tab;
the page token is "Page access" on Interface (`PageToken` in `web/src/pages/SettingsSecrets.tsx`, its own "Save" and
"Remove"); Tally's Postgres is the "Your own Postgres" form on Stats (`stats/tally`, `docs/stats.md`) and its classifier
the "Span classifier" section next to it (`ClassifierSettings`, one "Save" for the three `TALLY_LLM_*`, `secrets/update`;
a blank key keeps the saved one). Nothing of it goes into the drafts of the groups, and an empty field is not a removal
("Remove" is, or a cleared classifier address or model).

- **The catalog** — `secretCatalog` in `src/secrets/catalog.ts`: Tally's list and `EVEN_KEEL_TOKEN`. No tracker or CI
  variable is in it any more: both CI tokens are profiles'. `secrets/set`, `secrets/remove` and `secrets/update` (several
  at once, `null` removing one) refuse a name that is not in it.
- **Places** — the default profile of each tracker goes to the `env` of the global `settings.json` (sessions started by
  hand read it there, the tracker plugin with them); a Forgejo profile does not; Tally's and the page token only to `.env`. `.env` is edited one line at a
  time (`upsertEnv`, `removeEnv`), comments and order kept, then `EnvFile.reload` applies it (BTN-130). A written key
  reaches new sessions at their start; a removed one marks the global folder's daemon stale (`DaemonRefresh.expire`,
  `docs/accounts.md`) and the "Trackers and CI" tab says so while live sessions hold its stop (`sessionsPending`).
- **Secret or not** — by the name (`isSecret`): only `_URL`, `_WORKSPACE`, `_EMAIL`, `_HOST`, `_PORT`, `_NAME`,
  `_MODEL` are shown as they are; anything else, a new unknown name included, is a secret whose value never leaves the
  service, whole or in part.
- **From outside `.env`** — a variable the service's own environment sets (`EnvFile.isOuter`) wins over the file: the
  field is off and its tip says so.
- **The page token** — set only in the shape the start accepts (`guardToken`), and not removed while the service listens
  beyond loopback (`secrets.tokenRequired`).
- **Packages** — the MCP gateway gives packages the same `.env` (without the tracker variables) and the project's
  profile on top, so a key is shared by the service and the packages that read it. Splitting one off is a variable of its own for the packages, named in the adapter's
  `mcpKeys` (the gateway already passes a key under another name); its catalog entry then gets its own places.

## Labels as values

Labels live in the tracker and are matched case-insensitively. A definition with a `task_label` names a parser in code;
there is no mapping table:

- `run` — `<Provider> | <model>` or a bare `<Provider>` (`runLabelOf`): one label sets `provider` and `models.<provider>`.
  Read only while `modelLabels` is on, since older workspaces carry labels like `Sonnet`.
- `effort` — `effort:<level>` (BTN-146), its own prefix so it never collides with a model label; no switch needed.
- Two labels feeding the same setting with different values — a warning in the log and the project's value, as
  `runChoice` does now.
- Flags are not values: excluded and required labels are G/P settings that read labels, the manual labels become
  built in (`MANUAL_LABELS`, BTN-187), the question labels only mark the card.

The label syntax is part of the public contract (README), so it is code, not data. If users ever want their own names
(`Сонет` for a model), the cheap way is a G/P setting `labels.aliases` (alias → canonical label), applied before the
parsers — not a table.

## Decisions

- Definitions in code, mirrored into `setting_definitions` on start; values in `setting_values`. Recorded 2026-10-18 by
  this research; the user's two-table idea kept.
- BTN-118 "Storage without a hand-edited file" (2026-10-18, unattended, the cheapest to undo; the user confirmed it in
  BTN-190, closing BTN-192): no intermediate JSON in the state folder. The wizard and the removal write the project record into the same
  `even-keel.config.json` through `ConfigFile`, which becomes the database's writer once settings move (BTN-199).
  Without a file at start, the service creates an empty one (`version`, `projects: []`) and logs it; the one-time
  import and `EVEN_KEEL_CONFIG` go with that move.
- BTN-186 sits in milestone v0.1 because it blocks BTN-147 and BTN-118, which are there; a blocker in a later milestone
  would stop the chain.
- BTN-147 (2026-10-18, unattended, the cheapest to undo): the engine is `node:sqlite`; the database holds the state
  (`docs/storage.md`), while settings and project records stay in `even-keel.config.json`, since without the wizard a
  project is added only by editing that file.
- BTN-190 (2026-10-18, the user): settings and project records move into the database now, before the v0.1 release
  (BTN-199), on the tables above; the engine becomes PGlite (BTN-198, done first, so the settings tables are written
  there). The wizard writes through the BTN-186 writer with no intermediate JSON, as BTN-118 already does.
- BTN-199 (2026-10-18): the settings and project records are in the database (step 4). The config file is imported
  once, at the first start, and renamed `*.imported`; `EVEN_KEEL_CONFIG` stays only as its location. `unattended` and
  `trimTools` are Even Keel rows, `updates.dismissed` is in `service_state`. A hand edit is `config-export`, edit,
  `config-import`, which replaces the settings whole; the service looks at the database every 2 s, so an import applies
  at once. The page's writers still work on the format (`fileOf` → `withRows` → `fileRows`), so their tests and the
  golden samples hold.
- BTN-198 (2026-10-18): the engine is PGlite, its own folder `state/even-keel/`, not Tally's database; the service's
  main thread owns it and serves it to readers on a loopback port; the SQLite file is imported once
  (`docs/storage.md`). A settings step is a new entry of `STEPS` there.
- BTN-200 (2026-10-18, the user): the trackers' credentials are profiles in the state database, not `.env` lines; this
  replaces "never in the database" for them. Invariant 3 holds — the database is outside git. A secret goes to the page
  only as "set"; `config-export` leaves profiles out, the database's backup holds them (`docs/storage.md`).
