# Tally: the collector and its database

Reference for sessions working in `tally/`; the rules every such session needs are in `tally/CLAUDE.md`. Paths here are relative to `tally/` unless they name the root's.

A collector of Claude Code session stats (BTN-44): it reads through the transcripts of all sessions from all accounts and stores them in Postgres. Even Keel and the summaries then only read the database.

The database (BTN-70) is by default the embedded one: PGlite (`@electric-sql/pglite`, Postgres in WASM) in Even Keel's `<state>/tally/pgdata` (`EVEN_KEEL_STATE_DIR`, otherwise `state/`), with the same SQL as on the server. With `TALLY_DB_HOST` and the other `TALLY_DB_*` set, it is an external Postgres (on your own server, `tally/deploy`, BTN-45) with the roles `tally_writer` and `tally_reader`; the roles and `GRANT` exist only there. In the service the setting `tally` (`off`/`local`/`server`, BTN-247, `docs/stats.md`) decides which one, not the variables alone: `off` or not chosen — no collector and no database.

- PGlite has one session per process, so one process owns the folder (`src/local.ts`, `openLocalTally`): it opens the database (`timezone` is `UTC`, otherwise PGlite takes the host's zone), migrates the schema (below), starts a `PGLiteSocketServer` (`@electric-sql/pglite-socket`, the Postgres protocol) on `127.0.0.1` on a free port and writes `<state>/tally/owner.json` (`pid`, `port`). All clients — the collector, the `/stats` page, `sql.mjs` — go through this port with an ordinary `pg`: a direct `db.query` in the owner process would land inside someone else's open transaction, while the socket separates transactions (other connections wait for `commit`). The socket ignores connection options (`-c default_transaction_read_only`, `statement_timeout`).
- The owner is alive if the `pid` exists and the port is listening (after a crash the `pid` could have gone to another process). The folder is claimed before PGlite opens it, as the state database's is (BTN-320, the root's `src/storage/claim.ts`, `docs/storage.md`): `owner.json` with `{ pid, since }` and no port is put in place as a hard link, and the port is written over it once the server listens, so of two processes opening it together one is refused. A second process opening the folder while the owner is alive or still opening gets the error "process N (the Even Keel service) holds the local database…"; `sql.mjs` waits up to 30 s for the port of a claim without one. The service's `TallyService.stop` removes a claim of its own pid after it terminated the database thread, so a thread cut off mid-open does not hold the folder from the next one. `pg_try_advisory_lock` in PGlite is reentrant (one session), so against a second collector on the embedded database there is `owner.json`, while the lock remains for an external Postgres.
- After the process is killed (which is how the Windows service stops node), the database opens again and PGlite replays the WAL. Measured on the full history (2026-10-04): 838 files, 318 thousand rows — the first collection 100 s (9 s of it the rules), the next 1.3 s; 1.1 GB on disk (database 479 MB, `pg_wal` 561 MB). Reading the page — `history` 1.0–1.3 s, `period` 1.6–1.7 s, `steps` 0.3 s, `rules` 0.1 s (server: 1.4; 1.05–1.1; 0.74; 0.1 s). `period` is slower because its eight queries go through one session in turn.

## Subtopics

The area is split by subtopic, a file each in `docs/tally/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`collector.md`](tally/collector.md) | Running, what is read, schema version and migrations, machines elsewhere, compressing raw rows |
| [`schema.md`](tally/schema.md) | The schema |
| [`cost.md`](tally/cost.md) | Cost, limit share, signs, tasks from Huly |
| [`steps.md`](tally/steps.md) | Task time, steps, the classifier |
| [`rules.md`](tally/rules.md) | Rule versions, the session audit, tests |
