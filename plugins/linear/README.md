# linear

Linear for Even Keel: the `linear` tracker adapter in Even Keel itself, and for the sessions it runs Linear's remote MCP server (`https://mcp.linear.app/mcp`) with the `linear:task` skill. With them a session does more than get its issue in the prompt: it reads the issue, records decisions in its description, files blockers (Even Keel postpones the issue on them) and question issues, creates new issues, leaves a closing comment and merges. Closing is not the session's business: Even Keel moves the issue to the team's first completed state when its branch lands in `main`.

## Even Keel: the adapter

Even Keel reads the issues with its own key. Create a [personal API key](https://linear.app/settings/account/security) (Settings → Account → Security & access) and put it into Even Keel's `.env`:

```
LINEAR_TOKEN=lin_api_…
```

Even Keel strips `LINEAR_TOKEN` from the environment of the sessions it starts, so its key never reaches them.

**The project key is the team key.** A project on Linear is named after its team: the issue `ENG-12` belongs to the project `ENG`, and its branch is `eng-12/task`. The optional `linear` key narrows the team down to one Linear project, by name:

```json
{
  "projects": {
    "ENG": { "repo": "D:/work/web", "tracker": "linear", "linear": "Web app" }
  }
}
```

Without `linear` the chain takes the open issues of the whole team. `"tracker": "linear"` at the top level makes it the tracker of every project. One team is one Even Keel project: two repositories of the same team, told apart by Linear projects, cannot both run yet.

How Linear maps onto the chain:

| Even Keel | Linear |
| --- | --- |
| status | the team's workflow state, by its type: Triage and Backlog — backlog, outside the chain; Todo (`unstarted`) — ready; `started` — in progress; `completed` — done; `canceled` and Duplicate — canceled. The name is the state's name |
| blocked by | "blocked by" relations |
| parent, subtasks | sub-issues: an issue with sub-issues never enters the chain |
| labels | as they are: `Sonnet`/`Opus`/`Haiku` pick the model, `Question` marks a question |
| priority | Urgent, High, Medium, Low; No priority — none |
| milestone | the project milestone and its target date (not the cycle: unfinished issues roll over to the next cycle on their own) |
| estimate | none: Linear estimates are points |
| task card | the description and comments, labels, milestone, parent, `blocks` relations both ways, `related`; "Move to Todo" takes a Backlog-type issue to the team's first Todo-type state |

Linear has a backlog, so the chain works as with Huly: an issue enters it once it is moved to Todo or further. Links on the page lead to `https://linear.app/<workspace>/issue/ENG-12`; Even Keel learns the workspace when it connects.

## Sessions: the plugin

### API key

The MCP server takes a personal API key in the `Authorization` header from the session's environment: `LINEAR_API_KEY`. It may be the same key as Even Keel's or another one — not the variable `LINEAR_TOKEN`, which Even Keel strips from the sessions. Put it into the `env` of your Claude Code user settings, `~/.claude/settings.json`:

```json
{ "env": { "LINEAR_API_KEY": "lin_api_…" } }
```

Every session applies that `env` itself, and Even Keel carries `settings.json` over to every account folder before a launch. Without the variable the server answers 401 and the session has no Linear tools.

The server can set "blocks" relations itself (`save_issue` with `blockedBy`), so the skill needs nothing but it.

### Install

From the root of the project whose issues live in Linear:

```
claude plugin marketplace add <git URL or local path of the Even Keel repository>
claude plugin install linear@even-keel --scope project
```

or the same inside a session: `/plugin marketplace add …`, `/plugin install linear@even-keel`, and pick the project scope. The project scope writes `enabledPlugins` into the project's `.claude/settings.json`: Linear tools appear only where the work is tracked in Linear. Commit that file — Even Keel runs each task in a worktree made from `main`, and a worktree without it has no plugin.

Install with your default Claude Code config (no `CLAUDE_CONFIG_DIR` set). Even Keel carries the plugin registry of `~/.claude` over to every account folder before a launch, so sessions see the plugin whichever account runs them — and a plugin installed in an account folder alone is overwritten there.

### Even Keel config

The session reads the issue itself, so turn Even Keel's brief off for the project — otherwise the issue is read twice:

```json
{ "projects": { "ENG": { "repo": "D:/work/web", "tracker": "linear", "linear": "Web app", "brief": false } } }
```

With `brief` off, Even Keel checks that the project's sessions see the `linear` server and warns on the page if they do not.
