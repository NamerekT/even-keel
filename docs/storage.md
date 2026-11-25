# Storage

Even Keel's state is one PGlite database, the folder `state/even-keel/` (`EVEN_KEEL_STATE_DIR`): since BTN-147 a database, since BTN-198 PGlite instead of the `node:sqlite` file `state/even-keel.db`, since BTN-199 with the settings and the project records instead of the file `even-keel.config.json` (imported once, below). `account.json`, `packages.json` (and its cache `packages/`), `rate-limits.json`, `codex/`, `claude-sdk/` (BTN-239, `docs/sessions/sdk.md`) and `rule-history.jsonl` stay files of `state/`; Tally's database is its own (`docs/stats.md`).

The remaining JSON files written through `writeAtomic` (`src/storage/atomic.ts`) replace the destination with a temporary sibling file. On Windows, `rename` retries `EPERM`, `EACCES` and `EBUSY` for up to 3 seconds, with synchronous pauses growing from 10 to 100 ms; this keeps each write whole while an external reader or virus scanner briefly holds the destination. In-process readers of these files must use synchronous fs calls: an asynchronous read can leave a descriptor open until the event loop resumes, while the synchronous rename retries prevent that close for the entire retry window (BTN-499). The Codex and SDK registries read and list their session JSON synchronously while keeping their Promise interfaces. Other errors fail immediately. A failed write removes its temporary file. Off Windows the replaced file keeps its permissions (the temporary file is created owner-only and then given the old mode), so a `600` file does not turn `644` under the umask (EKR-95); a caller may name the mode instead, as `state/packages.json` does with `600` because a package's settings may hold a token. This covers the Codex and Claude SDK session registries, the account ledger, package state, file migrations and state exports; database transactions use their own storage path. The Windows reproduction and registry stress check are recorded in [verified.md](verified/sessions.md).

## Subtopics

The area is split by subtopic, a file each in `docs/storage/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`database.md`](storage/database.md) | The database: owner, tables, the socket port, vacuum |
| [`steps.md`](storage/steps.md) | The rules of a schema step and the newer steps (51 and later, with their file schema versions) |
| [`steps-older.md`](storage/steps-older.md) | The older steps (up to 50) and file schema versions |
| [`first-start.md`](storage/first-start.md) | Settings and import at the first start, backup, export, rollback, the memory repositories, readers outside the service |
