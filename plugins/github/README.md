# github

GitHub Issues for Even Keel: the `github` tracker adapter in Even Keel itself, and for the sessions it runs GitHub's remote MCP server ([github/github-mcp-server](https://github.com/github/github-mcp-server), toolsets `issues` and `labels`) with the `github:task` skill. With them a session does more than get its issue in the prompt: it reads the issue, records decisions in its body, files blockers (Even Keel postpones the issue on them) and question issues, creates new issues, leaves a closing comment and merges. Closing is not the session's business: Even Keel closes the issue as completed when its branch lands in `main`.

## Even Keel: the adapter

Even Keel reads the issues of a repository with its own token. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) with access to the repositories of your projects and the permission **Issues: Read and write** (Metadata: Read comes with it), and put it into Even Keel's `.env`:

```
GITHUB_TOKEN=github_pat_…
```

Even Keel strips `GITHUB_TOKEN` from the environment of the sessions it starts, so its token never reaches them; a session's own `gh` falls back to its stored login.

A project on GitHub names its repository with the `github` key:

```json
{
  "projects": {
    "ABC": { "repo": "D:/work/abc", "tracker": "github", "github": "octo-org/abc", "chain": { "requiredLabels": ["ready"] } }
  }
}
```

`"tracker": "github"` at the top level makes it the tracker of every project. The task id is `<project key>-<issue number>`: issue `#12` is `ABC-12`, and its branch is `abc-12/task`. Pull requests are not tasks.

How GitHub maps onto the chain:

| Even Keel | GitHub |
| --- | --- |
| status | open — `Open` (ready); closed as completed — `Completed` (done); closed as not planned — `Not planned`, as duplicate — `Duplicate` (canceled) |
| blocked by | the issue's "blocked by" dependencies |
| parent, subtasks | sub-issues: an issue with sub-issues never enters the chain |
| labels | as they are: `Sonnet`/`Opus`/`Haiku` pick the model, `Question` marks a question |
| priority | a label `priority: urgent`, `priority: high`, `priority: medium` or `priority: low` (also `priority/high`); none — no priority |
| milestone | the milestone and its due date |
| estimate | none |

**GitHub has no backlog**: every open issue is ready work, and without a rule the chain takes them all. Keep the entry on a label — `"chain": { "requiredLabels": ["ready"] }` — and add it to an issue once you have read it. Issues without it wait in the folded Backlog list under the chain. A blocker without the label does not count as one: label it too, or the issue it blocks runs first.

## Sessions: the plugin

### Token

The MCP server takes a token from the session's environment: `GITHUB_PERSONAL_ACCESS_TOKEN`, a fine-grained token with **Issues: Read and write** on the project's repository. It may be the same token as Even Keel's or another one. Put it into the `env` of your Claude Code user settings, `~/.claude/settings.json`:

```json
{ "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "github_pat_…" } }
```

Every session applies that `env` itself, and Even Keel carries `settings.json` over to every account folder before a launch. Without the variable the session counts the server as failed and has no GitHub tools.

"Blocked by" links have no MCP tool; the skill sets them with `gh api`, so the session needs the [GitHub CLI](https://cli.github.com/) logged in (`gh auth login`).

### Install

From the root of the project whose issues live on GitHub:

```
claude plugin marketplace add <git URL or local path of the Even Keel repository>
claude plugin install github@even-keel --scope project
```

or the same inside a session: `/plugin marketplace add …`, `/plugin install github@even-keel`, and pick the project scope. The project scope writes `enabledPlugins` into the project's `.claude/settings.json`: GitHub tools appear only where the work is tracked on GitHub. Commit that file — Even Keel runs each task in a worktree made from `main`, and a worktree without it has no plugin.

Install with your default Claude Code config (no `CLAUDE_CONFIG_DIR` set). Even Keel carries the plugin registry of `~/.claude` over to every account folder before a launch, so sessions see the plugin whichever account runs them — and a plugin installed in an account folder alone is overwritten there.

### Even Keel config

The session reads the issue itself, so turn Even Keel's brief off for the project — otherwise the issue is read twice:

```json
{ "projects": { "ABC": { "repo": "D:/work/abc", "tracker": "github", "github": "octo-org/abc", "brief": false } } }
```

With `brief` off, Even Keel checks that the project's sessions see the `github` server and warns on the page if they do not.
