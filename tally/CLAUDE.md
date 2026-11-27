# Tally

The collector of session stats: it reads the transcripts of every account (Claude, plus the spend of Codex, OpenCode and Copilot) into Postgres — the embedded PGlite in `<state>/tally/pgdata` by default, or an external one by `TALLY_DB_*` — and `/stats`, the audit skill and `sql.mjs` only read it. The rules of the root `CLAUDE.md` apply; below are only the rules and traps of this folder. How things are built is in `docs/tally.md`, an index of the files in `docs/tally/`; read the section you work in:

| Section of `docs/tally/` | Area |
| --- | --- |
| Running, What is read, The database's owner | the service's runs, a run by hand, the sources of every agent, incremental loading, who holds the database |
| Schema version and migrations, Schema | `schema_version`, the steps so far (`migrations.md`), every table and view, a response's task |
| Machines elsewhere | a machine's collector, `POST /link/tally`, the machine mark, `/stats` by machine |
| Compressing raw rows, Cost, Limit share | what `line_raws.raw` keeps, prices and `longPrompt`, limit windows and shares |
| Signs, Task time, Time reports, Long commands, The classifier | stuck spans, turns and waiting, the trackers' time reports, long commands, the span reasons from LiteLLM |
| Tasks from the trackers | task fields, follow-ups, where a task lives |
| Rule versions | rule files and keys, snapshots, history, the edit log `ruleHistory` and its hook |
| Session audit, Tests | the `tally:session-audit` skill, `sql.mjs`, what is tested and what is checked live |

## Rules

- **A schema change is a new step** at the end of `STEPS` (`src/migrations.ts`) and `TALLY_SCHEMA_VERSION` + 1 in the root's `src/stats/tally-schema.ts`; a view a step changes is redefined in full inside it. Never edit `schema.sql` or a merged step, never remove one.
- The `audit_*` columns never change: the audit skill's queries rely on them, and `create or replace view` takes no column in the middle — something new goes into a separate view.
- A new GPT model is a new price key in `tally.config.json`, never a shorter prefix such as `gpt-6`: one prefix would give every unlisted model of the family one price, and they differ 100×.
- Codex, OpenCode and Copilot write no `lines`: signs, steps and tool calls parse Claude's format. Their turns are read from each agent's own record (`TurnSource` in `refreshTurns`), not from `lines`.
- Tests are vitest next to the code; SQL views run on in-memory PGlite (`migrate`). Cost, `limit_shares`, the Huly time reports and LiteLLM are checked by a live run.

## Traps

- The service runs the collector as a worker from the code on disk: a merge or a build reaches it at the next run, before a restart. A worker with a step the running service lacks halts until the restart (`CollectRun.schema`), never migrating past the service.
- Try a new step on the embedded database of a temporary `EVEN_KEEL_STATE_DIR` first, with `TALLY_DB_HOST=` emptied: the user's environment may carry the server and its writer's password, and they outrank the folder.
- A run by hand (`npm run tally`) only while the service does not hold the database. Unset the session's `CLAUDE_CONFIG_DIR`/`CODEX_HOME` override to include the default global folder. From a worktree it needs `EVEN_KEEL_STATE_DIR=<main checkout>/state`, or it finds no projects.
- The collector never runs `claude -p /usage`: limits come from Even Keel, and an extra poll gives a 429 on the shared token.
- Queries go through `node <main checkout>/tally/bin/sql.mjs "<sql>"` (`-f file`, `--csv`, `-n 0` for every row): read-only, times in UTC; the embedded database answers only while the service runs.
