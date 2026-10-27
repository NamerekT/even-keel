# Tally

The collector of session stats: it reads the transcripts of every account (Claude, plus the spend of Codex, OpenCode and Copilot) into Postgres — the embedded PGlite in `<state>/tally/pgdata` by default, or an external one by `TALLY_DB_*` — and `/stats`, the audit skill and `sql.mjs` only read it. The rules of the root `CLAUDE.md` apply; below are only the rules and traps of this folder. How things are built is in `docs/tally.md`; read the section you work in:

| Section of `docs/tally.md` | Area |
| --- | --- |
| Running, What is read | the service's runs, a run by hand, the sources of every agent, incremental loading |
| Schema version and migrations, Schema | `schema_version`, the steps so far, every table and view, a response's task |
| Compressing raw rows, Cost, Limit share | what `lines.raw` keeps, prices and `longPrompt`, limit windows and shares |
| Signs, Task time, Steps, Classifier | stuck spans, turns and waiting, long commands, the span reasons from LiteLLM |
| Tasks from Huly | task fields, follow-ups, where a task lives, the time reports |
| Rule versions | rule files and keys, snapshots, history, the edit log `ruleHistory` and its hook |
| Session audit, Tests | the `tally:session-audit` skill, `sql.mjs`, what is tested and what is checked live |

## Rules

- **A schema change is a new step** at the end of `STEPS` (`src/migrations.ts`) and `TALLY_SCHEMA_VERSION` + 1 in the root's `src/stats/tally-schema.ts`; a view a step changes is redefined in full inside it. Never edit `schema.sql` or a merged step, never remove one.
- The `audit_*` columns never change: the audit skill's queries rely on them, and `create or replace view` takes no column in the middle — something new goes into a separate view.
- A new GPT model is a new price key in `tally.config.json`, never a shorter prefix such as `gpt-6`: one prefix would give every unlisted model of the family one price, and they differ 100×.
- Codex, OpenCode and Copilot write no `lines`: signs, steps and tool calls parse Claude's format. Codex turns are read directly from rollouts; OpenCode and Copilot have no turn times.
- Tests are vitest next to the code; SQL views run on in-memory PGlite (`migrate`). Cost, `limit_shares`, the Huly time reports and LiteLLM are checked by a live run.

## Traps

- The service runs the collector as a worker from the sources on disk: a merge reaches it at the next run, before a restart, so a new step migrates the live database while the page, on the old code, answers `newer` until the restart.
- Try a new step on the embedded database of a temporary `EVEN_KEEL_STATE_DIR` first, with `TALLY_DB_HOST=` emptied: the user's environment may carry the server and its writer's password, and they outrank the folder.
- A run by hand (`npm run tally`) only while the service does not hold the database. From a Claude Code session — only without `CLAUDE_CONFIG_DIR` (`env -u CLAUDE_CONFIG_DIR …`): with it the collector sees one account folder and rereads all the others from zero. From a worktree it needs `EVEN_KEEL_STATE_DIR=<main checkout>/state`, or it finds no projects.
- The collector never runs `claude -p /usage`: limits come from Even Keel, and an extra poll gives a 429 on the shared token.
- Queries go through `node <main checkout>/tally/bin/sql.mjs "<sql>"` (`-f file`, `--csv`, `-n 0` for every row): read-only, times in UTC; the embedded database answers only while the service runs.
