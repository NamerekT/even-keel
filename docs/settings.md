# Settings by level

The research of BTN-145 (2026-10-18): every setting Even Keel has, the levels it is set at, how they override each other,
and the schema of the settings tables the storage move into one database (BTN-147) builds on. The implementation is
split into BTN-186 (the registry over the current file), BTN-187 (the missing levels) and BTN-146 (effort, the first new
setting on three levels); the "Mismatches" and "Decisions" sections are what they follow.

## Levels

There are three levels and a default, narrowest wins: **task** → **project** → **Even Keel** → the built-in default.

- **Even Keel** (shared) — the top level of `even-keel.config.json`, written by the page `/settings`.
- **Project** — the project's entry in `projects[]`, written by the project's settings panel. A project's own value
  goes over the shared one; a value left out means "as shared".
- **Task** — only through a tracker label. Labels are the tracker's, not Even Keel's: nothing of the task level is
  stored, it is read off `Task.labels` on every launch.

Some settings are maps whose entries override one by one: `models`, `accounts` and `execution` by provider. A project's
`models.codex` replaces only the shared `models.codex`; the shared `models.claude` still applies to it.

## Inventory

As of 2026-10-18 (schema version 9). "Levels": G — Even Keel, P — project, T — task label. "Apply": live — at once,
restart — after a restart of the service (`RESTART_KEYS` in `src/config.ts`). "Written by": page, hand (the file), service.

### `even-keel.config.json`

| Key | Levels | Merge | Apply | Written by | Default |
| --- | --- | --- | --- | --- | --- |
| `parallel` | G | — | live | page, hand | 1 |
| `tracker` | G, P | P over G | restart | page, hand | `huly` |
| `brief` | G, P | P over G | live | page, hand | true |
| `chain.active`, `chain.terminal` | G, P | each key P over G; `null` — back to the status categories | live | page, hand | `null` |
| `chain.requiredLabels` | G, P | each key P over G, the list replaced whole | live | page, hand | `[]` |
| `chain.excludedLabels` | G, P | each key P over G, the list replaced whole | live | page, hand | `['Manual', 'Вручную']` |
| `provider` | G, P | P over G | live | page, hand, service (the "Even Keel" role, `saveActive`) | `claude` |
| `models.<provider>` | G, P | by provider, P over G | live | page, hand | `{ claude: 'opus' }` |
| `accounts.<provider>` | G, P | by provider, P over G | live | page, hand, service (`saveActive`) | `{ claude: 'global', codex: 'codex' }` |
| `execution.<provider>` | G | — | live | page, hand | the first mode of each provider |
| `modelLabels` | G, P | P over G | live | page, hand | false |
| `modelPrompts.<model>` | G | — | live | page, hand | `{}` |
| `language` | G | — | live | page, hand | `null` (the browser's) |
| `promptLanguage` | G | — | live | page, hand | `language`, else `en` |
| `hiddenSkills` | G | — | live | page, hand | `DEFAULT_HIDDEN_SKILLS` |
| `cacheTtl` | G | — | live | page, hand | `null` (the CLI's) |
| `allowedHosts` | G | — | live | page, hand | `[]` |
| `context.window`, `.warn`, `.danger` | G | — | restart | page, hand | 600000, 50, 80 |
| `stats.compare.*`, `stats.moves`, `stats.otherBelow` | G | — | live | page, hand | `DEFAULT_COMPARE`, `{}`, 0 |
| `stats.checkpointTokens` | G | — (pins the threshold, calibration off) | live | page, hand | `null` (calibrated per project) |
| `updates.check`, `updates.notify` | G | — | live | page, hand, service (`muteUpdates`) | true, true |
| `updates.dismissed` | G | — | live | service (`dismissUpdate`) | `null` |
| `slot` | P | — | restart | page, hand | none (a worktree per task) |
| `branch` | P | — | live | page, hand | `main` |
| `prompt` | P | — | live | page, hand | `null` |
| `commands.beforeStart`, `.check`, `.afterGreen` | P | each key on its own | live | page, hand | `[]` |
| `ci.guard`, `.kinds`, `.waitMinutes`, `.recheckMain`, `.fixTask` | P | each key on its own over `DEFAULT_CI` | live | page, hand | `DEFAULT_CI` |
| `fillMilestone` | P | — | live | page, hand | false |

Project record fields, not settings: `id` (written by the service for an entry without one, `withIds`), `key`, `name`,
`repo` (restart), the tracker's project (`github`, `linear` by `TrackerAdapter.projectKey`, restart). `version` is the
schema version of the file.

### Outside the config

| What | Where | Levels | Note |
| --- | --- | --- | --- |
| `unattended` | `state/chain.json` | G | a switch on `/settings`, sent at once (`chain/unattended`) |
| `trimTools` | `state/chain.json` | G | a switch on `/settings` (`chain/trim`) |
| a package's `default`, `settings` | `state/packages.json` `packages.<name>` | G | the package level: projects start from it |
| a project's `on`, `off`, `settings` | `state/packages.json` `projects.<id>` | P | over the package's, `settings` by variable |
| the run label `<Provider> \| <model>`, bare `<Provider>` | tracker label | T | sets `provider` and `models.<provider>`, read only while `modelLabels` is on |
| `Manual`/`Вручную` and other excluded labels | tracker label | T | matched by `chain.excludedLabels`, a G/P setting |
| required labels | tracker label | T | matched by `chain.requiredLabels` |
| `Question`/`Вопрос` | tracker label | T | `QUESTION_LABELS`: the card's mark and the prompts' wording; it changes neither the order nor the launch |
| Tally's `evenKeelUrl`, `signs`, `classify`, `reportsSince`, `prices` | `tally/tally.config.json` | — | the collector's own settings (`tally/CLAUDE.md`) |

### Not settings

- **Secrets** — `HULY_*`, `GITHUB_TOKEN`, `LINEAR_TOKEN`, `FORGEJO_TOKEN`, `EVEN_KEEL_TOKEN`, `TALLY_WRITER_PASSWORD`,
  `TALLY_READER_PASSWORD`, `TALLY_LLM_KEY`: stay in `.env` (invariant 3, BTN-131).
- **The address** — `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT`, `EVEN_KEEL_MCP_PORT`: read before anything else, from the
  environment.
- **Locations and binaries** — `EVEN_KEEL_CONFIG`, `EVEN_KEEL_STATE_DIR`, `EVEN_KEEL_ACCOUNTS_DIR`,
  `EVEN_KEEL_CODEX_ACCOUNTS_DIR`, `EVEN_KEEL_CLAUDE_BIN`, `EVEN_KEEL_CODEX_BIN`: needed before the storage is open (the
  database lives in the state folder), so they stay in the environment.
- **Tally's connection** — `TALLY_DB_*`, `TALLY_*_USER`, `TALLY_LLM_URL`, `TALLY_LLM_MODEL`, `TALLY_CONFIG`,
  `EVEN_KEEL_URL`: the collector's, which can run against an external Postgres. Tally's own file stays its own; its
  prices are reference data, already loaded into its `model_prices` table.
- **State that sits among settings** — `updates.dismissed` (the service writes it when a toast is closed), a package's
  catalog entry, installs and the task pins of `state/packages.json`, the account pool's sign-ins in `state/account.json`.
- **Project record fields** — `id`, `key`, `name`, `repo`, `branch`, the tracker's project. `branch` is a fact about the
  repository like `repo`, not a choice that could be shared; under BTN-66 `tracker` with the tracker's project becomes the
  project's reference to a tracker connection.

## Mismatches

What sits at a level it should not, or misses one it should have. BTN-187 takes the first group.

- `ci.*` is project-only: five projects that want `fixTask` set it five times. A shared level, each key over its own.
- `promptLanguage` is shared only, though projects differ in the language of their tasks. Add the project level.
- `stats.checkpointTokens` pins the threshold for every project while the calibration it switches off is per project;
  and it steers sessions, though it lives under `stats`. Add the project level; move the key under `sessions.` at the
  import into the database, where the keys are translated anyway.
- `cacheTtl` lacks the project level, `fillMilestone` the shared one.
- `context` is read once from the start-up config (`context: config.context` in `src/service.ts`), which alone makes it
  a restart key. Its `window` is a property of the model, not of Even Keel: by model, with a fallback row.
- `chain.excludedLabels` carries `Manual`/`Вручную` only as its default, and a list is replaced whole: a project, or a
  hand-written shared list, with its own excluded labels silently runs the manual tasks. Make the manual labels
  built-in like `QUESTION_LABELS` and the default list empty.
- `unattended` and `trimTools` are user settings kept in `state/chain.json`, and `updates.dismissed` is state kept in
  the config. Each moves to its own side with BTN-147.
- The model's project level, which the task's text missed, exists since BTN-173 (`models` in the project entry).

Levels that stay as they are: `parallel`, `execution` (the Codex sandbox does not start under the service for any project,
`docs/sessions.md`), `modelPrompts`, `hiddenSkills`, `language`, `allowedHosts`, `stats.*` besides the threshold,
`updates.*` — Even Keel only; `prompt`, `commands.*`, `slot` — project only.

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
  task_label    TEXT,               -- NULL | 'run' | 'effort': the label parser that feeds the task level
  apply         TEXT NOT NULL       -- 'live' | 'restart'
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

The SQL is the same for `node:sqlite` and PGlite (the engine is BTN-147's question); the expression index stands in for
a primary key over a nullable column.

- **A setting is a leaf replaced whole.** A nested object of today's file becomes one key per part wherever the parts
  merge or default on their own — all of them do now: `chain.*`, `ci.*`, `commands.*`, `context.*`, `stats.compare.*`,
  `updates.*`. A list (`kinds`, `hiddenSkills`, the labels, a command list) is one value, replaced whole, as now.
- **A map whose entries merge across levels gets a qualifier**: `models`, `accounts` and `execution` by provider,
  `context.window` by model (BTN-187), a package's switch and variables by package. A map with free keys that lives at
  one level only (`modelPrompts`, `stats.moves`) is one `json` value.
- **No row is inheritance; JSON `null` is a value.** `chain.active: null` (back to the categories over a shared list),
  `ci.waitMinutes: null`, `cacheTtl: null` are rows. "As shared" on the page deletes the row; nothing stores "inherit".
- **Packages**: `packages.enabled` (qualifier: the package) with the catalog's `default` as its Even Keel value and a
  project's `on`/`off` as its project rows; `packages.setting` (qualifier `<package>/<variable>`) with the package's
  values as Even Keel rows and a project's differing ones as project rows. The catalog, installs and pins stay state.
- **`unattended`, `trimTools`** become Even Keel rows; `updates.dismissed` goes to state. Both moves happen in BTN-147's
  import.
- **Project records** are a table of their own (`projects`: `id`, `key`, `name`, `repo`, `branch`, the tracker
  reference, `position` for the order of the file) — BTN-147.

## Reading and writing

One place reads and one place writes, so that BTN-147 swaps the source and not the callers (BTN-186):

```
even-keel.config.json ── fileRows ──┐
                                    ├─► project records + rows ── check each row by the registry ── resolve ──► EvenKeelConfig
database ─────────────── dbRows ────┘                                                    ▲
                                                                  task labels ── label parsers (task level, at launch)
```

- `fileRows(raw)` turns today's file into project records and rows — it is also the import of v0.1 files into the
  database, tested against the frozen samples in `test/fixtures/`.
- `resolve` gives each project's values: the task's label value, the project's row, the Even Keel row, the default — per
  qualifier for qualified keys. Cross-setting checks run after it, where `parseConfig` runs them now (`checkRules` on
  the merged rules, `promptLanguage` falling back to `language`). Its output is today's `EvenKeelConfig`, so `runSettings`,
  the dispatcher and the page do not change.
- `apply` of the definitions replaces `RESTART_KEYS`; `liveConfig` keeps the start-up values of the `restart` keys.
- A save of the page becomes a diff of rows (`set`, `unset`) between the form and its base; the file writer turns the
  diff back into JSON paths (replacing `withSharedForm` and `withProjectSettings`), the database writer into an upsert and
  a delete. A key the form did not change keeps the file's spelling, as now.
- Renaming or removing a setting stays what it is now: a new `SCHEMA_VERSION` and a migration step that moves or drops its
  rows.

## Labels as values

Labels live in the tracker and are matched case-insensitively. A definition with a `task_label` names a parser in code;
there is no mapping table:

- `run` — `<Provider> | <model>` or a bare `<Provider>` (`runLabelOf`): one label sets `provider` and `models.<provider>`.
  Read only while `modelLabels` is on, since older workspaces carry labels like `Sonnet`.
- `effort` — `effort:<level>` (BTN-146), its own prefix so it never collides with a model label; no switch needed.
- Two labels feeding the same setting with different values — a warning in the log and the project's value, as
  `runChoice` does now.
- Flags are not values: excluded and required labels are G/P settings that read labels, the manual labels become
  built-in (BTN-187), the question labels only mark the card.

The label syntax is part of the public contract (README), so it is code, not data. If users ever want their own names
(`Сонет` for a model), the cheap way is a G/P setting `labels.aliases` (alias → canonical label), applied before the
parsers — not a table.

## Decisions

- Definitions in code, mirrored into `setting_definitions` on start; values in `setting_values`. Recorded 2026-10-18 by
  this research; the user's two-table idea kept.
- BTN-118 "Storage without a hand-edited file" (proposed, for the user to confirm there): no intermediate JSON in the
  state folder. The wizard writes the project record and its rows through the BTN-186 writer, whichever source is
  current — the file before BTN-147, the database after it. Without a file at start, the service creates an empty one;
  the one-time import and `EVEN_KEEL_CONFIG` move to BTN-147.
- BTN-186 sits in milestone v0.1 because it blocks BTN-147 and BTN-118, which are there; a blocker in a later milestone
  would stop the chain.
