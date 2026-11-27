# Settings: levels, schema, reading and writing

## Levels

The narrowest level that has a value wins. Not every setting has every level: the "Levels" column of
`inventory.md` names them.

```
task → machine in a project → project (or, for a feed's task, the feed) → tracker profile → Even Keel → the built-in default
```

| Level | What sets it | Kept in | Settings at it |
| --- | --- | --- | --- |
| **Task** | the task card, the tasks server; a tracker label | `task_runs` (BTN-983, `docs/sessions/models.md`); `Task.labels`, read on every launch | the run (provider, model, effort, machines); `stats.checkpointTokens` by `Break \| compaction` ("Labels as values") |
| **Machine in a project** | the machine's settings tab | `project_machines.settings` | `commands.*`, a stdio server's command and arguments (below) |
| **Project** | the project's settings panel | the project's rows of `setting_values` (its entry in `projects[]` of the format) | every setting with P |
| **Feed** | the feed's window in the Tracker tab (`project/feed/rules`) | `feeds[].chain`, `feeds[].moves` | for a task of the feed (BTN-553), in place of the project's: the four rules of the profile level, the milestone rules, `statusMoves` |
| **Tracker profile** | a group per profile on `/settings` | `tracker_profiles.rules`, `.moves`, out of `config-export` (`docs/trackers/profiles.md`) | `chain.active`, `chain.terminal`, `chain.requiredLabels`, `chain.excludedLabels`, `statusMoves` |
| **Even Keel** (shared) | `/settings` | the rows of `setting_values` without a project (the top level of the format) | every setting with G |
| **Default** | the code | `src/settings/defaults.ts` | — |

- **A value left out means "as the level above".** A project's save writes a rule key only where its value differs from
  what the project inherits, the profile's over the shared one (BTN-334, `withProjectForm`), so a later change of the
  profile reaches the project.
- **A feed's task skips the project.** Its statuses and labels are another tracker's, so the project's own rules never
  reach it: feed → feed's profile → Even Keel. The milestone rules have no profile level on either path.
- **Maps merge by entry.** `models` and `accounts` override provider by provider at both levels: a project's
  `models.codex` replaces only the shared `models.codex`, and the shared `models.claude` still applies to it.
  `execution` and `cli` are maps by provider too, at Even Keel's level only.
- **The page** edits the rules by status and by label, one form on every level (`docs/web/project-settings.md`).

### A machine in a project

BTN-994: a machine elsewhere of a project's pool may have values of its own in that project: `commands.beforeStart`,
`commands.check`, `commands.afterGreen`, and the command and arguments of each stdio server of the project's packages
(`MachineProjectSettings`, `src/link/view.ts`). They are kept in `project_machines.settings` (step 60,
`docs/storage.md`), not in `setting_values`, so `config-export` leaves them out.

- **A list replaces the project's whole list**; a list left empty or out is the project's. A server's `command` and
  `args` replace the catalog's each on its own; one left out is the catalog's. Paths go into the arguments.
- **"Do not run" the commands after a green main** is `afterGreenOff: true` (BTN-1597): the machine runs neither its own
  nor the project's, and its own `afterGreen` list is dropped on save.
- **The own machine has none**: its values are the project's. The settings tab of a machine elsewhere edits them
  (`web/src/pages/MachineOwnValues.tsx`, the command `machines/settings`), each field showing the project's value in
  grey; "Connect a machine" may copy them from another machine of the pool (`copyFrom`).
- **The machine gets them in its brief from the hub** (`hubBrief`, `settingsOnMachine` in
  `src/service/machine-settings.ts`): its copy of the project's settings carries its own lists in place of the
  project's, and `HubBrief.servers` its server commands, which its packages' gateway puts in place of the catalog's
  (`withOverride` in `src/packages/stdio.ts`).
- **The connection's packages check** refuses a server whose command the machine does not find (`pool.serverMissing`).

### Why the levels are so

- **Both Even Keel and project** — where projects often want the same value but some differ: `ci.*` (five projects
  that want `fixTask` would set it five times), `promptLanguage` (projects differ in the language of their tasks),
  `cacheTtl`, `fillMilestone`. `prompt` too (BTN-338): one instruction for every project and agent, which no agent's
  own global rules file (`~/.claude/CLAUDE.md`, Codex's `AGENTS.md`) carries to the others, and the project's added
  after it.
- **`stats.checkpointTokens` at the project and the task** — the calibration it turns off is per project; turning the
  handoffs by context off is its own switch, `contextHandoffs` (BTN-255), not a pin.
- **No window setting** — the session's context window is the one its agent reports (BTN-187, BTN-1354,
  `docs/sessions/models.md`).
- **No built-in excluded label** — a list is replaced whole, so a default list silently stopped applying to a project
  with its own list. The list is empty until the user names a label (BTN-758, BTN-971); upgrades wrote the old default
  into the lists installations relied on (`docs/storage/steps-older.md`, steps 28 and 46).
- **Even Keel only** — `parallel`; `execution` (the Codex sandbox does not start under the service for any project, so
  there a command runs only by escalation or with `bypass`, `docs/sessions/protection.md`); `cli` (an account folder
  has one daemon, on one version, whatever project its sessions are for); `modelPrompts`, `hiddenSkills`, `language`,
  `allowedHosts`, `stats.*` besides the threshold and the shares, `updates.*`.
- **Project only** — what is about the repository: `commands.*` (with the machine below it), `slot`, `branch`.
- **The task** — only what runs the session: `provider`, `models` and the effort, the task's run (BTN-983). Not
  anything about the repository (`commands`, `ci`, `slot`, the tracker), the chain (`brief`, `chain.*`, `parallel`) or
  the page; and not `prompt`: the task's description is its prompt.
- **Switches and state apart** — `unattended` and `trimTools` are user settings, so Even Keel rows; `updates.dismissed`
  is state, in `service_state` (BTN-199).

## The schema

Two tables. The code is the source of the definitions, the database holds the values: a validator (the branch pattern,
`checkRules`, a placeholder in a model prompt) cannot live in SQL, and defaults change with releases, so a definitions
table authored in the database would need a migration every release. The table still exists: the service writes it
from the code's registry on every start, in one transaction (`mirrorDefinitions`), so values have a foreign key and SQL
readers (Tally, a support query) see what a key means. Step 4 of the database makes them (BTN-199).

```sql
CREATE TABLE setting_definitions (
  key           TEXT PRIMARY KEY,   -- the JSON path of the config's format: 'ci.fixTask', 'models', 'chain.active'
  kind          TEXT NOT NULL,      -- boolean | integer | number | string | enum | list | json
  spec          TEXT NOT NULL,      -- JSON, written as '{}': the checks are code
  default_value TEXT,               -- JSON; NULL when the code computes it (promptLanguage from language)
  scopes        TEXT NOT NULL,      -- 'global' | 'project' | 'global,project'
  qualifier     TEXT,               -- NULL | 'provider' | 'notice'
  task_label    TEXT                -- NULL | 'checkpoint': the label parser that feeds the task level
);

CREATE TABLE setting_values (
  key        TEXT NOT NULL REFERENCES setting_definitions(key),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- NULL: Even Keel itself
  qualifier  TEXT NOT NULL DEFAULT '',                         -- a provider or a notice kind; '' when none
  value      TEXT NOT NULL,                                    -- JSON; JSON null is a value, not inheritance
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL                                     -- page | service | import | hand
);
CREATE UNIQUE INDEX setting_values_target ON setting_values (key, COALESCE(project_id, ''), qualifier);
```

The expression index stands in for a primary key over a nullable column (PGlite).

- **A setting is a leaf replaced whole.** A nested object of the format is one key per part wherever the parts merge or
  default on their own: `chain.*`, `ci.*`, `commands.*`, `context.*`, `stats.compare.*`, `updates.*`. A list (`kinds`,
  `hiddenSkills`, the labels, a command list) is one value, replaced whole.
- **A map whose entries merge across levels gets a qualifier**: `models`, `accounts`, `execution`, `cli` by provider,
  `notices` by kind. A map with free keys at one level only (`modelPrompts`, `stats.moves`) is one `json` value.
- **No row is inheritance; JSON `null` is a value.** `chain.active: null` (back to the categories over a shared list),
  `ci.waitMinutes: null`, `cacheTtl: null` are rows. Going back to the shared value on the page (the "own" chip)
  deletes the row; nothing stores "inherit".
- **Project records** are a table of their own (`projects`: `id`, `key`, `name`, `repo`, `branch`, `tracker_projects`,
  `feeds`, `position` for the order of the format).
- **Packages are not settings rows**: the catalog's switches and variables, a project's `on`/`off`, installs and pins
  stay in `state/packages.json` (`inventory.md`, "Outside the settings tables").

## Reading and writing

One place reads and one place writes, so the source could change without the callers (BTN-186; the database since
BTN-199). The code is in `src/settings/`:

```
a file (import) ──── fileRows ─────┐
                                    ├─► project records + rows ── checkRows ── resolve ──► EvenKeelConfig
database ─────────── readSettings ──┘                                  ▲
                                                 task labels ── LABEL_PARSERS (task level, at launch)
```

- **`registry.ts`** — `DEFINITIONS` (key, kind, scopes, qualifier, task label, the `EvenKeelConfig` fields it lands
  in, default, check), `OBJECTS` (the nested objects and their unknown keys), `LABEL_PARSERS`; `defaults.ts` — the
  built-in values. A definition has no "apply" mark: every key applies at once (BTN-130).
- **`file.ts`** — `fileRows` (the format → project records and unchecked rows, the shape checked; also the import of
  every older file, tested against the frozen samples of `test/fixtures/`), `fileOf` (back), `withRows` (row changes →
  the format's JSON paths, an unset dropping the objects it empties; a key not changed keeps the file's spelling).
- **`store.ts`** — the tables: `mirrorDefinitions` (every start), `readSettings` (one statement → records and rows),
  `saveSettings` (whole replace in one statement), `putSettings` (upsert only).
- **`import.ts`** — `configOfFile` (a file of any schema → records and rows, `updates.dismissed` taken out),
  `prepareSettings` (the import at the first start), `exportConfig`, `importConfig` (`docs/storage.md`).
- **`resolve.ts`** — `SettingRow`, `ProjectRecord`, `checkRows`, `resolve` (`shared`, each project's `own` and
  `values`: the task's label value, the project's row, the Even Keel row, the default, per qualifier), `inherit` (the
  one merge rule, also behind `runSettings`).
- **`changes.ts`** — `RowChange` and `changesOf`: a form as `FormValue`s by group, each changed group's values `set`
  or `unset` against what having no row gives. The unit of change is the group: a field of the form (`ci`, `context`,
  `stats`, `updates` whole), one rule of `chain`, one provider of the shared `models`, `accounts`, `execution`.
- **`src/config-store.ts`** — `ConfigStore`, the service's copy: the contents in memory, `current` the last valid
  parse, a save written behind (`Writes`), and every 2 s a look at the database that applies a change written by
  someone else (`config-import`) at once.

`parseConfig` is `fileRows` + `checkRows` + `resolve` + the cross-setting checks (`checkRules` on the merged rules,
`promptLanguage` falling back to `language`). The page's writers (`withSharedForm`, `withProjectForm`,
`withProjectSettings`, `withUpdates`, `withSwitches`, `withNotice`, `withRunAccount` and the others of
`src/config-form.ts`) map their fields to `FormValue`s and write the diff through `withRows` on the format
(`ConfigStore.raw()`), which the store turns back into rows.

What a launch runs on does not go through `resolve`: it is `runChoice` over the task's run, which also falls back when
the pool has no account for the run's provider. Renaming or removing a setting is a new `SCHEMA_VERSION` and a step
that moves or drops its rows.

## Tests

- **Expected defaults** — `src/settings/expectations.fixture.ts` holds them for the config, the project settings and
  the forms, independent of the code: it does not call the parser or read the registry, so a wrong default still fails
  the defaults test. A new setting goes there once, in `common` when both levels share it. Store and HTTP tests give
  only their overrides and still compare the whole result; a test of a single field needs no fixture.
- **Golden snapshots** — `src/settings/golden/` holds the output of `parseConfig` for every frozen sample, the example
  config and `full.fixture.ts`, as differences from those defaults (`difference.fixture.ts`): `changed` maps
  JSON-pointer paths to non-default values (project identities and repositories among them), `missing` lists absent
  default fields, a project's included. A new default needs no snapshot edit; changing an expected default in the
  fixture is a deliberate change of behaviour. A sample's own changes and migrations change their snapshots: look at
  them before accepting an update. Never change the frozen inputs in `test/fixtures/` to make these tests pass.

## Credentials (BTN-131)

Credentials are never in a draft or the settings tables. Each is set where its use is set (BTN-355), and nothing of it
goes into a group's draft; an empty field is not a removal ("Remove" is, or a cleared classifier address or model).

| What | Set on | Written to |
| --- | --- | --- |
| a tracker's or a CI's credentials (Forgejo's among them, BTN-201) | a profile's row and "Add profile" on "Trackers and CI" (BTN-200, `docs/trackers/profiles.md`), each with its on/off switch (`profiles/disable`, BTN-830) | the profile in the state database; the default profile of each tracker also into the `env` of the global `settings.json`, for hand sessions and their tracker plugin, unless "Hide from hand sessions" is on (BTN-1498); a Forgejo profile never |
| the page token `EVEN_KEEL_TOKEN` (the owner key, BTN-1619) | "Sign-in by key" on Sign-in and devices (`PageToken`, `web/src/pages/SettingsSecrets.tsx`) | `.env` |
| Tally's Postgres (`TALLY_DB_*`, `TALLY_*_PASSWORD`) | "Your own Postgres" on Stats (`stats/tally`, `docs/stats.md`) | `.env` |
| Tally's classifier (`TALLY_LLM_URL`, `_KEY`, `_MODEL`, `_DICTATION_MODEL`) | "Span classifier" on Stats (`ClassifierSettings`, one "Save", `secrets/update`; a blank key keeps the saved one) | `.env` |
| the badge's push secret `EVEN_KEEL_BADGE_SECRET` (BTN-915) | the badge's dialog (BTN-917) | `.env` |

- **The catalog** — `secretCatalog` (`src/secrets/catalog.ts`) lists the `.env` variables of the table: Tally's, the
  page token, the badge secret. `secrets/set`, `secrets/remove` and `secrets/update` (several at once, `null` removing
  one) refuse a name not in it.
- **Writing `.env`** — one line at a time (`upsertEnv`, `removeEnv`), comments and order kept, then `EnvFile.reload`
  applies it (BTN-130). A written key reaches new sessions at their start; a removed one marks the global folder's
  daemon stale (`DaemonRefresh.expire`, `docs/accounts.md`), and "Trackers and CI" says so while live sessions hold
  its stop (`sessionsPending`).
- **Secret or not** — by the name (`isSecret`): only `_URL`, `_WORKSPACE`, `_EMAIL`, `_HOST`, `_PORT`, `_NAME`,
  `_MODEL` are shown as they are; anything else, a new unknown name included, is a secret whose value never leaves the
  service, whole or in part. A profile's secret goes to the page only as "set".
- **From outside `.env`** — a variable the service's own environment sets (`EnvFile.isOuter`) wins over the file: the
  field is off and its tip says so.
- **The page token** — set only in the shape the start accepts (`guardToken`), and not removed while the service
  listens beyond loopback (`secrets.tokenRequired`).
- **Packages** read keys from the gateway's pool (`docs/packages/files.md`, "Keys"), so a key is shared by the service
  and the packages that read it. Splitting one off is a variable of its own for the packages, named in the adapter's
  `mcpKeys`.

## Labels as values

Labels live in the tracker and are matched case-insensitively. A definition with a `task_label` names a parser in code
(`LABEL_PARSERS`); there is no mapping table. The label syntax is part of the public contract (README), so it is code,
not data.

- **`checkpoint`**, the only one — `Break | compaction` pins the task's threshold to 999999; `Break | handoff` or no
  label inherits the project's threshold, and so do both together (`docs/sessions/checkpoint.md`).
- **Two labels feeding one setting** with different values — a warning in the log and the project's value.
- **Flags are not values**: excluded and required labels are G/P settings that read labels, and the question labels
  only mark the card. A task's run and effort are fields of its run, not labels (BTN-983).

## Decisions

- **Definitions in code, values in the database** (2026-10-18): the registry is mirrored into `setting_definitions` on
  every start, values are rows of `setting_values` ("The schema").
- **Settings and project records in the state database** (BTN-190, BTN-199, 2026-10-18): the config file is imported
  once, at the first start, and renamed `*.imported`; `EVEN_KEEL_CONFIG` names only that file. A hand edit is
  `config-export`, edit, `config-import`, which replaces the settings whole and applies within 2 s. The page's writers
  still work on the format (`fileOf` → `withRows` → `fileRows`), so their tests and the golden samples hold.
- **The engine is PGlite** (BTN-198), its own folder `state/even-keel/`, not Tally's database: the service's main
  thread owns it and serves readers on a loopback port (`docs/storage.md`). A settings step is a new entry of `STEPS`.
- **The trackers' credentials are profiles in the state database**, not `.env` lines (BTN-200, the user's decision).
  Invariant 3 holds: the database is outside git. `config-export` leaves profiles out; the database's backup holds them
  (`docs/storage.md`).
