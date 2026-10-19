# huly

Huly for sessions that Even Keel runs: the `huly` MCP server ([@firfi/huly-mcp](https://www.npmjs.com/package/@firfi/huly-mcp)) and three skills. With them a session does more than get its task in the prompt: it reads the task and its attachments, records decisions in the description, files blockers (Even Keel postpones the task on them) and question tasks, creates new tasks, leaves a closing comment and merges. Statuses are not the session's business: Even Keel closes the task in Huly when its branch lands in `main`.

| Skill | |
| --- | --- |
| `huly:task` | working a task from pickup to merge, creating tasks |
| `huly:split` | when a task is worth splitting, and creating subtasks Even Keel runs one by one |
| `huly:setup` | putting a repository on Huly once: project, components, milestone, `CLAUDE.md` block, plugin, Even Keel entry |

A `PreToolUse` hook (`hooks/check-marks.mjs`, needs `node`) refuses a write to Huly whose markdown puts inline code inside bold, italics, strikethrough or a link: the server takes it, but Huly's editor then cannot open the description (`RangeError: Invalid collection of marks`). The session gets the offending fragments and sends the text again with the code moved out.

A second `PreToolUse` hook (`hooks/show-calibration.mjs`) runs when a session sets an estimate (`create_issue` or `update_issue` with `estimation`). It asks Even Keel for the project's estimate calibration — what closed tasks estimated at each step actually took, and recent closed tasks of the same component — and adds it to the session's context, once per session and project. The context arrives with the call's result, so the session corrects the estimate with another `update_issue` if it is off. Sessions rarely did, so when the step sent disagrees with the data — at least `stats.compare.minTasks` closed tasks on it, and their median more than 1.5 times away from the step — the hook refuses that call instead, with the calibration and the step nearest the median, and lets the retry through (it counts as the one showing for the session and project). Even Keel is looked for at `EVEN_KEEL_URL` (default `http://127.0.0.1:4747`; set it in the `env` of `~/.claude/settings.json` if yours runs elsewhere); no Even Keel, no statistics or no closed tasks — the hook stays silent.

## Credentials

Create a separate account in Huly for Even Keel and its sessions, give it access to the projects, and use its e-mail and password — in an Even Keel profile and here alike. A token is the alternative only if your Huly shows an API tokens page in the account settings: released self-hosted Huly has no such page, and the token it signs in with is obtained from the e-mail and password anyway.

The MCP server reads them from the environment of the session:

| Variable | |
| --- | --- |
| `HULY_URL` | Huly address, e.g. `https://huly.example.com` |
| `HULY_WORKSPACE` | workspace identifier |
| `HULY_EMAIL`, `HULY_PASSWORD` | the account's e-mail and password |
| `HULY_TOKEN` | instead of them, an API token where your Huly has them |

Put them into the `env` of your Claude Code user settings, `~/.claude/settings.json`:

```json
{ "env": { "HULY_URL": "https://huly.example.com", "HULY_WORKSPACE": "example", "HULY_EMAIL": "john.doe@example.com", "HULY_PASSWORD": "…" } }
```

Every session applies that `env` itself, and Even Keel carries `settings.json` over to every account folder before a launch. System environment variables do not work for the chain: Even Keel strips `HULY_*` from the environment of the sessions it starts, so that its own account from its `.env` never reaches them — the sessions work under the account you give the plugin.

## Install

From the root of the project that is tracked in Huly:

```
claude plugin marketplace add <git URL or local path of the Even Keel repository>
claude plugin install huly@even-keel --scope project
```

or the same inside a session: `/plugin marketplace add …`, `/plugin install huly@even-keel`, and pick the project scope. The project scope writes `enabledPlugins` into the project's `.claude/settings.json`: Huly tools appear only where the work is tracked in Huly. Commit that file — Even Keel runs each task in a worktree made from `main`, and a worktree without it has no plugin.

Install with your default Claude Code config (no `CLAUDE_CONFIG_DIR` set). Even Keel carries the plugin registry of `~/.claude` over to every account folder before a launch, so sessions see the plugin whichever account runs them — and a plugin installed in an account folder alone is overwritten there.

## Even Keel config

The session reads the task itself. Nothing to switch: while a package of the project brings the `huly` server, Even Keel leaves the task's description out of the prompt (`brief` left as auto). With `brief: false` set explicitly, Even Keel checks that the project's sessions see the `huly` server and warns on the page if they do not.

## The session has no Huly tools

- The plugin loads when a session starts: a session that was running during the install does not get it.
- A worktree has the plugin only if `.claude/settings.json` with `enabledPlugins` is committed to `main`.
- The server fails to start or its calls fail — the credentials are missing from the session's environment: check the `env` of `~/.claude/settings.json`, not the system environment (see Credentials).
- The plugin was updated but sessions run the old one — the installed copy is cached by version; a change to the plugin needs a new `version` in `.claude-plugin/plugin.json`, then `claude plugin update huly@even-keel`.
