# What has been verified

The log of live checks. When an entry of [`unverified.md`](unverified.md) is checked, it moves here instead of vanishing; a check that covers only part of an entry narrows the entry there and adds what passed here. What is still open stays in `unverified.md`; a line here does not mean the whole feature is checked, only the behaviour it names. Every live check gets a row, not only those of `unverified.md` entries: a "Проверка" task, a live run inside an ordinary task, a sandbox or server run — what was checked, where, when, on which versions, by which task and commit, with what result. A document of an area may still say a behaviour was checked live, but with a link to its row, not instead of it.

The rows are kept in one file per area ("Areas" below), the same files as those of `unverified.md`, so one thing is looked up in the same place in both. The entries from before 2026-10-26 were rebuilt from the history of `unverified.md` (the commits named in the table), by their text, not by hashes: the history before 2026-10-21 was rewritten and its old hashes are dead. Checks that never had an entry there are taken from the phrases of `docs/` ("checked live", "seen live", "Checked on …"), from the commits that wrote them and from the manual "Проверка" tasks of the tracker; the behaviour a document states without a date or a place is not here.

A path into `.temp/` in a row names where the shots and scripts of the check lay. The `.temp/` of the main checkout was emptied on 2026-10-30 (BTN-503): a cited folder that is gone is no missing evidence, the row's own text carries the result.

An absence is a finding too, and it goes stale: "the provider has no X" — no API for a job log, no list of models, no fork — is written in `docs/` and in a row here with the provider's version it was checked on and the way it was looked for (the endpoint asked, the help read). A claim without them is not a finding, and a session that relies on one checks it first. The Forgejo job log taught this: a row said "the job log only on the host" for Forgejo 16.0.3, and on 2026-10-30 the same 16.0.3 gave it at `GET /actions/jobs/{id}/logs` (BTN-605).

## How an entry reads

One row is one check.

| Column | What it says |
| --- | --- |
| Behaviour | what was seen, not the name of the task |
| Where | the kind of place: Windows Sandbox ("sandbox"), the service on the author's workstation, a server, the author's own GitLab CE, GitLab.com, GitHub, a fake forge in the sandbox, a second instance in a terminal. No host names, addresses, folders or accounts |
| Date | the day of the run (YYYY-MM-DD), as the commit says; the commit's own date if the run's was not written |
| Versions | the CLI, the tracker or the forge, when written down. Even Keel is the commit in the last column or its parent |
| Task, commit | the task and the commit that lifted or narrowed the entry in `unverified.md` |
| Result | **whole**, **with a caveat** (what stayed open or went wrong), or **bugs found** (their IDs) |
| Session | the first eight characters of the Claude Code session id (the transcript's file name; Tally has the same id) that made the commit named in "Task, commit", found by that commit's subject in the session's `git commit` call. A long hand session stands at many rows: it is told apart by the commit. Empty where no session was found: a Codex, OpenCode or Copilot session, a transcript no longer kept, a commit made before the history rewrite of 2026-10-21 under another hash, or a commit that no session's transcript names |

## Areas

One file per area, each with its own table. The first twelve are the areas of [`unverified.md`](unverified.md#areas) under the same file names.

- [Platforms](verified/platforms.md) — operating systems, Node.js, git on Windows, the start at sign-in
- [Updating](verified/updating.md) — the update button, npm, Huly's client, plugin marketplaces
- [The page](verified/page.md) — the header, the setup wizard, a chain's pauses as the page shows them
- [Accounts](verified/accounts.md) — sign-in, plans, extra and paid subscription usage, API keys' organizations
- [Claude limits](verified/claude-limits.md) — Claude's usage windows, their resets and polls
- [Sessions](verified/sessions.md) — Claude Code sessions and what every agent shares: the CLI copy, the Agent SDK, recovery, handoffs, the chat, Protection
- [Codex](verified/codex.md), [OpenCode](verified/opencode.md), [Copilot](verified/copilot.md) — that agent's sessions, sign-in, limits and stats
- [Packages](verified/packages.md) — plugins and MCP servers of a project's set, the gateway
- [Trackers](verified/trackers.md) — tracker profiles, statuses, OAuth, task feeds
- [CI](verified/ci.md) — CI runs, commands after a green main, pull requests and conflicts
- [Rule history hooks](verified/rule-history-hooks.md) — Tally's history of rule files and the size hook
- [Seen in daily work](verified/seen-in-daily-work.md) — counts from the service log of what runs every day
- [Unclear](verified/unclear.md) — commits that claim a live check without saying which entry it lifted

A new row goes at the end of the table of its area's file. The check of an `unverified.md` entry goes into the file of the same name as the entry's; a check with no entry, into the area of the behaviour. A new area is a new file here and in `unverified/`, and a line in both lists.
