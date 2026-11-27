# Storage

Even Keel's state is one PGlite database, the folder `state/even-keel/` (`EVEN_KEEL_STATE_DIR`). It holds the chain state, the launch log, the settings and the project records; the config file `even-keel.config.json` and the older state files are imported into it once, at the first start ([`first-start.md`](storage/first-start.md)).

Beside it stay files of `state/`: `account.json`, `packages.json` (and its cache `packages/`), `rate-limits.json`, `codex/`, `claude-sdk/` (`docs/sessions/sdk.md`) and `rule-history.jsonl` ([`files.md`](storage/files.md)), and the machine's own database `state/machine/` (`docs/machines/seam.md`, "The machine's stores"). Tally's database is its own (`docs/tally.md`).

## Subtopics

The area is split by subtopic, a file each in `docs/storage/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`database.md`](storage/database.md) | The database: owner, writes, every table, vacuum |
| [`steps.md`](storage/steps.md) | The rules of a schema step, the machine database's steps and the state steps 51 and later |
| [`steps-older.md`](storage/steps-older.md) | The state steps 1–50 and the file schema versions |
| [`first-start.md`](storage/first-start.md) | The import and the settings at the first start, readers outside the service |
| [`backup.md`](storage/backup.md) | Backup by hand and automatic, export, rollback, `config-export`/`config-import`, the memory repositories |
| [`files.md`](storage/files.md) | The JSON files that stay and their atomic writes |
| [`tests.md`](storage/tests.md) | What the tests keep on disk: the database templates, the run's temp folder, git templates |
