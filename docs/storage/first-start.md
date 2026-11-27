# The first start and readers

## Import at the first start (`src/storage/state-files.ts`)

`src/start.ts` runs `upgradeStorage` (the files to their current schema, `docs/chain/state.md`) and then `prepareDatabase`:

- **With a database**: it is opened as its owner and brought to the current step. A v0.1 state file (`chain.json`, `questions.json`, `launches.jsonl`, `handoffs/`) or `even-keel.db` still next to it is not read; the log says so once per start.
- **Without one, but with the SQLite file** `even-keel.db` (versions 1–2): its rows are read whole (`sqliteRows`; the journal is switched to `DELETE` first, so a WAL the old service left folds into the file) and written into a new database `state/even-keel.import/` in one transaction (`insertRows`, which also moves the id counters past the rows). The folder is renamed to `state/even-keel` only once complete, the file to `even-keel.db.imported`; the log line counts the rows per table. A copy of a live state came over row for row in about 2.5 s ([`../verified/updating.md`](../verified/updating.md)).
- **Without either**: the v0.1 files are read and checked whole (`readStateFiles`; a damaged or newer file is `storage.damaged` / `storage.newer` and nothing is written) and imported the same way; then each file or folder is renamed to `<name>.imported`. A handoff snapshot that does not parse is left out and logged.
- **Nothing at all**: an empty database.
- **A failed import** removes `even-keel.import` and leaves everything as it was (`storage.importFailed`).
- **Windows**: the rename of `even-keel.import` is retried for up to three seconds when it fails with `EPERM`, `EACCES` or `EBUSY` (`renameOver`, `src/storage/atomic.ts`): a virus scanner or the indexer may hold the folder just closed (BTN-674).
- **A blocked start**: an fs or database error shows as the notice's detail on the page and as a `cause:` log line after the main one, with its code and path when the message lacks them (`noticeWithCause`, `causeLine`, `src/notice/notice.ts`).

Tests: the state-file import on the samples `test/fixtures/schema-v2` … `v9` (`src/storage/state-samples.test.ts`), the SQLite import on `database-v1` and `v2` (`database-sqlite.test.ts`).

## Settings at the first start (`src/settings/import.ts`)

After `prepareDatabase`, `src/start.ts` runs `prepareSettings`. It mirrors the definitions and, the first time (no `config.imported` in `service_state`), imports the config file (`EVEN_KEEL_CONFIG`, `even-keel.config.json` of the root by default) whole in one transaction:

- brought to the current schema (`currentConfig`); entries without an id get one;
- checked as the service would run it;
- `updates.dismissed` taken out into `service_state`;
- Even Keel-level rows already in the database (`unattended`, `trimTools`, which state step 4 moved from `chain_flags`) stay unless the file sets them.

The file is renamed to `even-keel.config.json.imported`; the log line counts projects and settings. A file that does not parse stops the start with its notice (the blocked page) and stays as it is. No file: an empty start, marked imported too.

Later starts never read the file: one found there is logged as not read. `upgradeStorage` still runs first, so a pre-v9 config file of an old install is migrated together with the state files before the import.

## Readers outside the service

`readStateDatabase` (`src/storage/owner.ts`) neither migrates nor reads a database of another version (`checkVersion`).

- **With a live owner** it connects to its port. A live owner always means "connect", even with the reader's own pid, because Tally's collector runs in a worker thread of the service.
- **With no owner** it opens the folder itself and, while open, owns it the same way: `owner.json` and a port, so a second reader connects to it.
- **A claim without a port** is waited for, up to 30 seconds, and then connected to: a reader started together with the service reads through it instead of failing.

Trap: the port needs PGlite 0.5.17 or later (BTN-1437). An older one answers a failed extended-protocol query with an extra ReadyForQuery, so a reader in another process gets every answer one query late until `Received unexpected parseComplete message`. In one process `pg.Client` hides it, so `state-reader-errors.test.ts` reads the port message by message, not through `pg`.

What Tally's collector reads this way, and without a database, is in [`../tally/collector.md`](../tally/collector.md#running).
