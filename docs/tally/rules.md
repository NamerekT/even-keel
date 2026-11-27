# Rule versions, audit and tests

## Rule versions (BTN-50)

Which rule texts (CLAUDE.md, skills, memory, hooks, settings, agents) were in effect when — so that `/stats` can compare spend before and after a change.

### The rule file and its key

A rule file's **key** is `ruleFileOf` (`src/rules.ts`): the same file seen in different places gets one key, and its versions are counted under it.

- `~/.claude` and the account folders become one key `~/.claude/…`, except `settings.json` and `.claude.json`: each account has its own.
- So do the stores those folders link to (BTN-366, the root's `src/account/share.ts`): `~/.claude-skills/<name>/…` is `~/.claude/skills/<name>/…`; `~/.claude-hooks/…` and `~/.claude-agents/…` are `~/.claude/hooks/…` and `~/.claude/agents/…` (BTN-373); `~/.claude-memory/<slug>/…` is `~/.claude/projects/<slug>/memory/…`, since chain sessions write memory by the store's path (`autoMemoryDirectory`).
- A worktree becomes the main checkout, and a project folder loses the drive letter and case (a project may move to another drive).
- `~/.githooks/**` are hooks (without logs, `*.bak*`, `*.tmp`, `package*.json`). Of `.claude.json` only `mcpServers` and `projects.*.{mcpServers, allowedTools}` are stored, with `env`/`headers` values as `***`.
- `skills/synced/**` and `skills/.*/**` are no rules; a skill folder `skills/<name>` itself is no file (`rm -r`/`cp -r` of a folder is not written as an edit, BTN-52).
- The text is `canon` (CRLF → LF, whitespace at the edges trimmed), SKILL.md without frontmatter; the hash is SHA-1.

### Tables

`rule_texts` (text by hash), `rule_files` (key, kind, folder), `rule_seen` (what a session received: `instructions`, `nested_memory`, the body of an invoked skill, a skill's description from `skill_listing`), `rule_snapshots` + `rule_snapshot_files` (disk snapshots), `rule_versions` (versions from `file-history`, backups and git), `rule_edits` (edits by `Edit`/`MultiEdit`/`Write`/`NotebookEdit` and writes to a rule file from `Bash`/`PowerShell` — `added` 0, `removed` empty), `rule_changes` (text changes: source `snapshot`, `transcript`, `file-history`, `backup`, `git`, +/−), `rule_imports` (the edit log, below), `tally_meta`.

### Where versions come from

- **Snapshots**, every run (`snapshotRules`): `~/.claude`, the account folders, `~/.claude.json`, `~/.githooks`, and per project of Even Keel `git ls-files` of the rules and `.claude/settings.local.json`; only files with a changed size or `mtime` are hashed.
  - A file is recorded as deleted only where the run looked (`goneKeys`, BTN-150, BTN-551): a global file only if its file or containing tree was inspected, a project's only when git listed its repository this run. Account copies use the same keys as their files; skipped links and unreadable folders do not authorize deleting their trees. A folder left out of the account scan, or a project that dropped out (the config unread or empty, git failed), stays as it was.
  - The first run is the initial state, without events; so is a file that first got into a snapshot with an old `mtime`.
- **History before snapshots** (`collectRuleHistory`): the transcripts' `file-history-snapshot` (copies in `<account folder>/file-history/<session>/`), the backups `~/.claude/backups/` (`CLAUDE.md.*.bak`, `.claude.json.backup.<ms>`), and `git log --first-parent <branch>` of each project's rules on the project's `branch` (`select repo, branch from projects`; read onward from `rules_git:<repo>` in `tally_meta`).
- **The time rule.** Under each key, the versions from transcripts and history are ordered by first appearance: the first is the initial one, each next a change, and only versions earlier than the key's first snapshot count. So the sources give no false changes against each other.
- **A rule change of the collector**: when `RULES_VERSION` (`src/rule-steps.ts`) changes, a run rereads all transcripts from zero for the rules alone (~10 s) and recomputes the changes.
- **A one-time repair** (`src/rule-repair.ts`, BTN-551) still runs, and touches only the false deletion/restoration pairs under `~/.claude/` of one UTC window on 2026-10-28, so a new installation has nothing for it ([`../verified/rule-history-hooks.md`](../verified/rule-history-hooks.md)).
- **How far back**, on the maintainer's database: the texts of CLAUDE.md and memory in transcripts since 2026-09-04 (CLI 2.1.260), skill descriptions and bodies since 2026-08-03, hooks, settings and `.claude.json` since the first snapshot (2026-10-03) and before it only from backups, `file-history` and git.

### The edit log

`ruleHistory` in `tally.config.json` (by default `<EVEN_KEEL_STATE_DIR>/rule-history.jsonl`, outside git). A row is a set `{ id, at, until?, atPrecision exact|hour|day, sessions, files [{ path, action, summary }], purpose, reason, task, source }`. Each run adds new rows and deletes vanished ones (the key is the row's SHA-1); a broken row goes to the log. The server attaches the goal, reason and task to a session's edit set from `sessions` when the time agrees within a tolerance (30 min / 1 h / 24 h by precision); otherwise the log's set stands alone, marked as diverging.

### The rule hook (`tally/bin/rule-hook.mjs`, BTN-151)

The sessions fill the log themselves, prompted by the hook (logic in `src/rule-hook.ts`), wired in `~/.claude/settings.json` by the absolute path to the main checkout: `PostToolUse` with the matcher `Edit|MultiEdit|Write` and `Stop`, both `node "<main checkout>/tally/bin/rule-hook.mjs"`. An edit of another file ends before TypeScript loads (`tsx` from the main checkout's `node_modules`); any error ends the hook silently. What a session was reminded of is `<state>/rule-hook/<session>.json`, swept after a month; its optional `oversized` and `sizeBlocked` fields extend it, and old files still work.

- **The journal.** An edit of a rule file (`ruleFileOf`, memory excluded) adds a reminder to the context, once per file per session: the file, the log's path, the row format with its `id` filled in (one past the largest numeric `id` of the log, BTN-374) and the row to go after the last line, the session id, the allowed `purpose`.
  - A stop of a session that changed rule files and has no row with its id (a prefix, as the server matches) is blocked once, with the same reminder and the session's rows that do not parse; so is one whose row has an `id` another row has too, with the next free `id`.
  - The next stop passes; a later one is blocked again only for rule files edited since.
- **The size.** Every edit of `CLAUDE.md` and `AGENTS.md`, global or nested, is checked against a 13,000-byte ceiling (`src/rule-hook-size.ts`).
  - Only these exact-case names count, for the ceiling and for the journal alike: Linux loads neither `claude.md` nor `agents.md`, and a lowercase `docs/sessions/agents.md` is an area document; the folders' case does not matter. The hook's name check does not change how the collector's snapshots classify files.
  - The bytes before come from `tool_response.originalFile` (zero for a new `Write`), the bytes after from the file on disk; a missing original or an unreadable file leaves the check silent.
  - Growth above the ceiling adds instructions to the edit reminder, even for a file already mentioned: move architecture details, history, task ids and measurements to the area's document or JSDoc; keep principles and traps every task needs, without telegraph-style compression or dropping rules for space. Only the user may raise the ceiling.
  - The edit is never rejected. Stop is blocked once per affected file even with a valid journal row, respecting `stop_hook_active`; the journal and size reminders share one block when both apply. A reduction clears the pending warning, even above the ceiling; an edit of equal size adds none.
  - The root and Tally `CLAUDE.md` also have a vitest ceiling check (the root's `scripts/instruction-size.test.ts`), for agents without Claude hooks and for growth through merges. What a live session showed is in [`../verified/rule-history-hooks.md`](../verified/rule-history-hooks.md).

## Session audit (BTN-53)

The audit is the skill `tally:session-audit` of the plugin `plugins/tally` (BTN-263, in Even Keel's marketplace; installed by hand in Claude Code, user scope): from any project it compares a recent period with an earlier one — spend, context, tasks, stuck spans, rule changes between them — looks for what changed, and reviews handoffs and compactions (the `handoffs`, `handoff_notes` and `compactions` views). The weekly audit is a special case: the last 7 days against the 7 before them. Its SQL relies on the `audit_*` columns, so a change to them is checked against the skill's queries.

- The skill calls the plugin's launcher `bin/sql.mjs`, which finds the checkout (`EVEN_KEEL_HOME`; else the folders above the plugin, with `tally/bin/sql.mjs` and `tally/tally.config.json`; else `packages.marketplace.dir` of `/api/state` of the running service) and runs its `tally/bin/sql.mjs` with the same arguments and stdin.
- Queries go through `tally/bin/sql.mjs` from any folder (`node <main checkout>/tally/bin/sql.mjs "<sql>"`, `-f file` or stdin): it takes `pg` and `.env` from the main checkout. An external Postgres — the `tally_reader` role (`TALLY_READER_PASSWORD`, `TALLY_READER_USER` to change the name); the embedded database — the port from `<EVEN_KEEL_STATE_DIR or the main checkout's state>/tally/owner.json`, which answers only while the service runs (otherwise "served by the Even Keel service, and it is not running"). The `TALLY_*` variables and `EVEN_KEEL_STATE_DIR` outrank `.env` ([the trap](collector.md#running)).
- The transaction is read-only: `insert` and the like are rejected by the database. Every value prints as the database's own text (BTN-252): times in UTC with `+00`, `date` and `interval` as Postgres writes them, arrays as `{…}`, `null` as an empty cell; a day by the local zone needs `at time zone` in the query. The collector is not run for an audit.
- The ready sums are the `audit_*` views ([`schema.md`](schema.md#views)); the queries and the shape of the report are in the skill.
- Prices are an API estimate, not a subscription bill; tasks in `tasks` are refreshed once an hour, so a status may lag.

## Tests

- **Pure logic** is tested by vitest next to the code (`src/*.test.ts`), on synthetic transcripts and in-memory stores.
- **Views** run on in-memory PGlite with the whole schema (`migrate`): the tasks, `limit_shares` against its first body from `schema.sql`, `limit_shares_stored` against `limit_shares` row for row; migrations with test steps (`src/migrations.test.ts`).
- **`src/limit-views.test.ts`** substitutes the bodies of `limit_steps`, `limit_intervals` and `limit_windows` from `schema.sql` as CTEs over test snapshots that shadow `limit_snapshots`. Without `TALLY_DB_HOST`/`TALLY_READER_PASSWORD` it runs on in-memory PGlite; with them, on the live database with the `tally_reader` role, read-only (from a worktree: `node --env-file=<main checkout>/.env node_modules/vitest/vitest.mjs run tally/src/limit-views.test.ts`).
- **The GitLab and Jira time reports**: `src/tracker-times.test.ts` on a faked tracker, their API calls in the adapters' `source.test.ts`, and a live run (EKR-36, [`../verified/trackers.md`](../verified/trackers.md)).
- **Only a live run checks**: the cost, `limit_shares` on real data, `task_repeats`, `session_times`, `task_times`, the time reports to Huly and the requests to LiteLLM.
