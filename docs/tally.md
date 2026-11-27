# Tally: the collector and its database

Reference for sessions working in `tally/`; the rules every such session needs are in `tally/CLAUDE.md`. Paths in these documents are in `tally/` unless they are marked as the root's.

A collector of Claude Code, Codex, OpenCode and Copilot session stats (BTN-44): it reads the transcripts of all sessions from all accounts and stores them in Postgres. Even Keel's `/stats` page, the badge and the audit then only read the database.

## Which database

In the service the setting `tally` (BTN-247, `docs/stats.md`) picks it:

- `off`, or not chosen — no collector and no database.
- `local` — the embedded database: PGlite (`@electric-sql/pglite`, Postgres in WASM) in Even Keel's `<state>/tally/pgdata` (`EVEN_KEEL_STATE_DIR`, otherwise `state/`), with the same SQL as on the server (BTN-70). One process owns it ([`collector.md`](tally/collector.md#the-databases-owner-srclocalts)).
- `server` — an external Postgres (your own server, `tally/deploy`, BTN-45) at the address of `TALLY_DB_HOST` and the other `TALLY_DB_*`, with the roles `tally_writer` and `tally_reader`; the roles and `GRANT` exist only there.

The `TALLY_DB_*` variables act only for `server` in the service. `npm run tally` by hand ignores the setting: with `TALLY_DB_HOST` set it takes the server, without it the embedded database.

## Subtopics

The area is split by subtopic, a file each in `docs/tally/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`collector.md`](tally/collector.md) | Running, what is read, the database's owner, schema version and migrations, machines elsewhere, compressing raw rows |
| [`migrations.md`](tally/migrations.md) | Every migration step of Tally's database, in order |
| [`schema.md`](tally/schema.md) | The tables, the views, a response's task |
| [`cost.md`](tally/cost.md) | Cost and prices, limit share, signs, tasks from the trackers |
| [`time.md`](tally/time.md) | Task time and time reports, long commands, the classifier, other LiteLLM spend |
| [`rules.md`](tally/rules.md) | Rule versions and the rule hook, the session audit, tests |
