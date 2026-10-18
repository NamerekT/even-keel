# Storage

Even Keel's state is one PGlite database, the folder `state/even-keel/` (`EVEN_KEEL_STATE_DIR`): since BTN-147 a database, since BTN-198 PGlite instead of the `node:sqlite` file `state/even-keel.db`. The config stays the file `even-keel.config.json`; `account.json`, `packages.json` (and its cache `packages/`), `rate-limits.json`, `codex/` and `rule-history.jsonl` stay files of `state/`; Tally's database is its own (`docs/stats.md`). Settings and projects move into the database before the v0.1 release (BTN-199): the user's answer in BTN-190.

## The database (`src/storage/database.ts`, `src/storage/owner.ts`)

- The engine is PGlite (Postgres in WASM, the one Tally embeds): the folder holds `pgdata/` and, while a process holds it, `owner.json`.
- A PGlite folder has one session in one process. The service's main thread owns it: `src/main.ts` opens it before the service module loads (`prepareDatabase` → `keepDatabase`), `src/service.ts` takes it (`keptDatabase`) and closes it last on shutdown. The owner serves the database to `pg` clients on a loopback port of its own (`@electric-sql/pglite-socket`) and writes `{ pid, port }` into `owner.json`; an owner is live only when its pid runs and its port answers, so a file left by a crash is no owner.
- Queries are small: no worker thread. Readers through the port see whole transactions: the server gets a proxy of the database whose `runExclusive` also takes the transaction lock (`wholeTransactions`), so a read never lands between the statements of the service's transaction.
- Writes are not awaited by the service: `Writes` tracks them, logs a failure (`storage: … not saved`) and is settled on shutdown before the database closes. Order holds because PGlite runs queries and transactions in the order they were called, and every write starts its first query at the call. Writes of several rows go through `inTransaction` (a call inside another joins it).
- `Mailbox` keeps its rows in memory (`Mailbox.open`) and writes behind, so `settle` stays atomic in one thread and `getState` stays synchronous; the posted questions are loaded at start (`loadQuestions`) and saved behind.
- A project is named by its id (`projects[].id` of the config) in every `project_id`; `src/chain/store.ts` renames to keys and back with `config.ids`, as it did for the files (`docs/chain.md`).
- Tests use `memoryDatabase()` (`src/storage/memory.ts`): a clone of a database migrated once per test file. The first one of a file takes seconds under a full run, hence the 30 s timeouts of those files.

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
| `mailbox` | chat messages to working sessions (BTN-181): `task`, `session_id`, `text`, `files` (JSON paths), `posted_at`, `fate` (`waiting`, `delivered`, `returned`, `dismissed`), `event`, `settled_at`; settled rows go a week after they settled, at the next post | `src/sessions/mailbox.ts`, `docs/sessions.md` |

- The chain state is written whole on every save (`writeChainRecord`: delete and insert in one transaction), as the file was; the launch log is appended to.
- `closed_tasks` is filled by the chain's `finish` (`archiveClosed` in `src/service.ts`) for every task but a fix of main, with the title the tracker last gave. Nothing reads it yet: it is for the page and the tracker profiles to come (BTN-66).

## Schema steps

- Versions 1 and 2 were the SQLite file (`PRAGMA user_version`); the numbering goes on in PGlite from 3. The version is the one row of `schema_version`. `STEPS[n]` takes the database from version `2 + n` to the next one in one transaction together with the new version, so a step that fails leaves the old version and none of its tables. Step 3 is the tables of the SQLite versions in Postgres; `DATABASE_VERSION` is `2 + STEPS.length`.
- A database newer than the code is refused before anything is written: `storage.newerDatabase`, the blocked page (`src/main.ts`). So is a SQLite file of a version above 2.
- A step is never edited or removed once merged. A schema change is a new step and a new frozen sample `test/fixtures/database-v<N>/even-keel.sql` (the SQL of the tables and rows of that version). `src/storage/database.test.ts` checks that step 3 still makes exactly the schema of the v3 sample (columns, indexes, constraints), that the sample migrates and reads whole, and that the SQLite samples `database-v1/`, `database-v2/` are imported whole.
- The database's version is separate from `SCHEMA_VERSION` of the files (`src/storage/schema.ts`), which still versions the config and the files that stay.

## Import at the first start (`src/storage/state-files.ts`)

`src/main.ts` runs `upgradeStorage` (the files to their current schema, `docs/chain.md`) and then `prepareDatabase`:

- With a database: it is opened as its owner and brought to the current step. A v0.1 state file (`chain.json`, `questions.json`, `launches.jsonl`, `handoffs/`) or `even-keel.db` still next to it is not read; the log says so once per start.
- Without one, but with the SQLite file `even-keel.db` (versions 1–2): its rows are read whole (`sqliteRows`; the journal is switched to `DELETE` first, so a WAL the old service left folds into the file), written into a new database `state/even-keel.import/` in one transaction (`insertRows`, which also moves the id counters past the rows), and that folder is renamed to `state/even-keel` only once complete. The file is renamed to `even-keel.db.imported`; the log line counts the rows per table.
- Without either: the v0.1 files are read and checked whole (`readStateFiles`; a damaged or newer file is `storage.damaged` / `storage.newer` and nothing is written) and imported the same way; then each file or folder is renamed to `<name>.imported`. A handoff snapshot that does not parse is left out and logged.
- A failed import removes `even-keel.import` and leaves everything as it was (`storage.importFailed`). Nothing at all: an empty database.

Tested on every frozen sample `test/fixtures/schema-v2` … `v9` and `database-v1`, `v2` (`src/storage/state-files.test.ts`, `database.test.ts`). The SQLite import was run on a copy of the live state on 2026-10-18 (889 launches, 93 snapshots, 10 closed tasks: every table came over with the same row count, in about 2.5 s).

## Backup, export, rollback

- `npm run storage -- backup <dir>` — a copy into a new folder laid out like `state/even-keel` (`<dir>/pgdata`), also while the service runs: all tables read in one statement (`rowsOf`), so the copy is consistent, then written into a fresh database (`backupDatabase` in `src/storage/copy.ts`). To restore, stop the service and put the folder in place of `state/even-keel`. With the config it is everything a move to another machine needs.
- `npm run storage -- export <dir>` — the state as the v0.1 files, into an empty folder. A v0.1 Even Keel reads them, and so does the import: to roll back, stop the service, export, put the files into `state/` of the old version.
- Both read the database of `EVEN_KEEL_STATE_DIR` (the checkout's `state/` by default; `.env` is loaded) through `readStateDatabase`. `closed_tasks` has no file: only the backup keeps it.

## Readers outside the service

`readStateDatabase` (`src/storage/owner.ts`) neither migrates nor reads a database of another version (`checkVersion`). With a live owner it connects to its port; a live owner always means "connect", even with the reader's own pid, because Tally's collector runs in a worker thread of the service. With no owner it opens the folder itself and, while open, owns it the same way: `owner.json` and a port, so a second reader connects to it.

Tally's collector (`evenKeelState` in `tally/src/collect.ts`) reads the launch log and the snapshots this way. Without a database it reads the SQLite file (`sqliteInMemory`: its rows in a database in memory) or else the v0.1 files: a merge reaches the collector before the restarted service has imported them.
