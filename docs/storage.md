# Storage

Even Keel's state is one SQLite database, `state/even-keel.db` (`EVEN_KEEL_STATE_DIR`), since BTN-147. The config stays the file `even-keel.config.json`; `account.json`, `packages.json` (and its cache `packages/`), `rate-limits.json`, `codex/` and `rule-history.jsonl` stay files of `state/`; Tally's database is its own (`docs/stats.md`). Whether settings and projects move into the database, and when, is the question BTN-190.

## The database (`src/storage/database.ts`)

- The engine is `node:sqlite` (`DatabaseSync`, built into Node 24): synchronous like every caller of the state, one file, WAL mode, a 5 s busy timeout. Node 24 prints one `ExperimentalWarning: SQLite is an experimental feature` on stderr at the first open; it is expected.
- The service opens one connection at start (`src/service.ts`) and keeps it. Writes of several rows go through `inTransaction` (`BEGIN IMMEDIATE`; a call inside another joins it).
- A project is named by its id (`projects[].id` of the config) in every `project_id`; `src/chain/store.ts` renames to keys and back with `config.ids`, as it did for the files (`docs/chain.md`).

| Table | What it holds | Code |
| --- | --- | --- |
| `chain_flags` | `unattended`, `trimTools` (JSON values) | `src/chain/store.ts` |
| `chains` | the active chains in order: `project_id` and the rest of `ActiveChain` as JSON | same |
| `chain_queue` | projects waiting for a chain slot, in order | same |
| `chain_lists` | per project: `orders`, `skipped`, `leftovers`, `released`, `ci` (JSON values) | same |
| `questions` | questions posted to the tracker (`docs/trackers.md`) | same |
| `launches` | the launch log: `at`, `project_id`, `task`, `session_id`, `reason`, the other fields of `LaunchEntry` as JSON in `extra` | same |
| `handoffs` | a snapshot per handoff for Tally, keyed by the new session | `src/chain/snapshots.ts` |
| `closed_tasks` | the archive of tasks the chain ran and saw done: project, task, tracker, title, link, when; one row per task, a reopen and a new Done keep the latest | `saveClosedTask` |

- The chain state is written whole on every save (`writeChainRecord`: delete and insert in one transaction), as the file was; the launch log is appended to.
- `closed_tasks` is filled by the chain's `finish` (`archiveClosed` in `src/service.ts`) for every task but a fix of main, with the title the tracker last gave. Nothing reads it yet: it is for the page and the tracker profiles to come (BTN-66).

## Schema steps

- The version is `PRAGMA user_version`. `STEPS[n]` takes the database from version n to n + 1 in one transaction together with the new version, so a step that fails leaves the old version and none of its tables.
- A database newer than the code is refused before anything is written: `storage.newerDatabase`, the blocked page (`src/main.ts`).
- A step is never edited or removed once merged. A schema change is a new step and a new frozen sample `test/fixtures/database-v<N>/even-keel.sql` (the SQL of the tables and rows of that version); `src/storage/database.test.ts` checks that step 1 still makes exactly the tables of the v1 sample and that the sample migrates and reads.
- The database's version is separate from `SCHEMA_VERSION` of the files (`src/storage/schema.ts`), which still versions the config and the files that stay.

## Import of the v0.1 files (`src/storage/state-files.ts`)

`src/main.ts` runs `upgradeStorage` (the files to their current schema, `docs/chain.md`) and then `prepareDatabase`:

- With a database: it is brought to the current step. A v0.1 state file still next to it (`chain.json`, `questions.json`, `launches.jsonl`, `handoffs/`) is not read; the log says so once per start.
- Without one: the files are read and checked whole (`readStateFiles`; a damaged or newer file is `storage.damaged` / `storage.newer` and nothing is written), written into `even-keel.db.import` in one transaction, and that file is renamed to `even-keel.db` only once complete. A failure removes the temporary file and leaves the files as they were (`storage.importFailed`). Then each file or folder is renamed to `<name>.imported`; the log line counts what moved. A handoff snapshot that does not parse is left out and logged.
- No files and no database: an empty database.

Tested on every frozen sample `test/fixtures/schema-v2` … `v9` (`src/storage/state-files.test.ts`) and checked on a copy of the live state on 2026-10-18 (862 launches, 83 snapshots: the database reads back exactly what the files held; export and import again gave the same).

## Backup, export, rollback

- `npm run storage -- backup <file>` — a consistent copy (`VACUUM INTO`) while the service runs; a new file only. With the config it is everything a move to another machine needs.
- `npm run storage -- export <dir>` — the state as the v0.1 files, into an empty folder. A v0.1 Even Keel reads them, and so does the import: to roll back, stop the service, export, put the files into `state/` of the old version.
- Both read the database of `EVEN_KEEL_STATE_DIR` (the checkout's `state/` by default; `.env` is loaded) read-only. `closed_tasks` has no file: only the backup keeps it.

## Readers outside the service

Tally's collector (`evenKeelState` in `tally/src/collect.ts`) opens the database read-only (`readDatabase`: no migration, a database of another step refused) for the launch log and the snapshots. Without a database it reads the v0.1 files: a merge reaches the collector before the restarted service has imported them.
