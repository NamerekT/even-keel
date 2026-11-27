# Claude Code plugins (BTN-64)

- The repository is the marketplace `even-keel` (`.claude-plugin/marketplace.json`), one plugin per tracker in `plugins/<tracker>/`: the tracker MCP (`.mcp.json`) and skills (`skills/<name>`, invoked as `<tracker>:<name>`). `task` — working a task; Huly also has `split` — splitting into subtasks and `setup` — putting a repository on the tracker. The skills are in English and carry no foreign names or measurements. There is one non-tracker plugin there — the built-in `agent-bridge` (the session bridge, `docs/packages.md`).
- Installed with the global configuration (without `CLAUDE_CONFIG_DIR`): `claude plugin marketplace add <repository>`. Chain sessions get a plugin as a package of the project (`docs/packages.md`): "Add a package" in the package catalog (`/settings` → Packages) copies it from the marketplace, whatever `enabledPlugins` says. For sessions started by hand, `claude plugin install huly@even-keel --scope project` in the project repository — `enabledPlugins` in the project's `.claude/settings.json`; `share.ts` transfers the plugin registry into account folders. Whether the prompt then carries the task's description is the auto brief of [`layer.md`](layer.md#the-brief).
- A plugin change needs a new `version` (the rule is in `CLAUDE.md`). A marketplace added from a local path is the exception (CLI 2.1.301): `claude plugin list --json` shows `readFromFolder` and `folderVersion` next to the cached `version`, and sessions load the plugin from that folder, so a `git pull` there reaches the next sessions without `claude plugin update` (BTN-157).

### `huly` — the model

- The server is `@firfi/huly-mcp`. The credentials (`HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` or `HULY_EMAIL`/`HULY_PASSWORD`) are inherited from the session environment and are not in `.mcp.json`, which has only the constant `TOOLSETS` (the set for working a task).
- `${…}` substitutions in a plugin's `.mcp.json` are unsuitable for a session that runs the server itself: an unset variable, even with a `:-` default, makes the session consider the server failed and not start it (`claude mcp list` still says "Connected"), and the server does not accept an empty `HULY_TOKEN`.
- Chain sessions: the gateway runs the server in its HTTP mode with the `HULY_*` of the project's profile (`docs/packages.md`); the session sees only the gateway's address. `sessionBase` removes `HULY_*` from the sessions' environment.
- Sessions started by hand: the default Huly profile's credentials are in `env` of `~/.claude/settings.json`, unless the profile is hidden from them ([`profiles.md`](profiles.md#hidden-from-sessions-started-by-hand-btn-1498)): the session applies it itself, and `share.ts` transfers the file into account folders.
- How to use it — `plugins/huly/README.md`.
- OpenCode gets both Huly guards from `plugins/huly/opencode/huly.mjs` (plugin 0.5.8): markdown writes are checked before execution; estimate calibration shares the command hook's request and once-per-session marks. For MCP calls OpenCode passes the raw result to `tool.execute.after`, so calibration is appended as a text block in `content`, before OpenCode assembles the output (the plugin also accepts the assembled `output` shape). Checked live with OpenCode 1.18.25 ([verified](../verified/opencode.md)).

### `github` (BTN-65)

- The remote GitHub server (`api.githubcopilot.com/mcp/`, toolsets `issues,labels`). An HTTP server needs the token in a header, so a `${GITHUB_PERSONAL_ACCESS_TOKEN}` substitution is used here — without the variable the server is useless anyway. For chain sessions the gateway fills it from the `GITHUB_TOKEN` of the project's profile (the adapter's `mcpKeys`) and adds the header itself; a session started by hand needs `GITHUB_PERSONAL_ACCESS_TOKEN` of its own.
- The MCP has no "blocked by" links — the skill sets them via `gh api …/dependencies/blocked_by`.
- How to use it — `plugins/github/README.md`.

### `linear` (BTN-72)

- The remote Linear server (`mcp.linear.app/mcp`). It accepts a personal key in a header — `Authorization: Bearer ${LINEAR_API_KEY}`; for chain sessions the gateway fills it from the `LINEAR_TOKEN` of the project's profile (`mcpKeys`), a session started by hand needs `LINEAR_API_KEY` of its own.
- The server sets "blocks" links itself: `save_issue` with `blockedBy`/`blocks`.
- How to use it — `plugins/linear/README.md`.

### `gitlab` (BTN-410)

- The stdio package `@zereight/mcp-gitlab@2.3.11`, with `GITLAB_TOOLSETS: "issues,milestones"`: REST issue tools are available from launch. Work-item tools are disabled because their GraphQL queries include `WorkItemWidgetStatus`, which CE/Free does not expose and rejects for the whole query. The task skill uses `get_issue` and does not offer work-item hierarchy changes through this package.
- Why not the official MCP: it rejects a legacy `api` PAT and requires OAuth with `mcp` or a separate fine-grained MCP token, while the community server takes the adapter's credentials and works on self-managed hosts without OAuth.
- The gateway fills `${GITLAB_PERSONAL_ACCESS_TOKEN}` through `mcpKeys` from `GITLAB_TOKEN`, and `${GITLAB_URL:-https://gitlab.com}` into `GITLAB_API_URL`; the package normalizes the web root to `/api/v4`. The session only sees the local gateway.
- How to use it — `plugins/gitlab/README.md`.

### `jira` (BTN-417)

- The official Atlassian Rovo MCP server (`https://mcp.atlassian.com/v2/mcp`), which takes an API token in `Authorization: Basic base64(email:token)`. A community server was not taken: the official one accepts the same token as the adapter. Its limits come from Atlassian: the organization admin must turn on API token authentication for the server, and only a token with scopes gets Jira tools — a classic one gets Teamwork Graph tools only. Tools take the site's `cloudId`, which the skill gets from `getAccessibleAtlassianResources`.
- The header is built from two keys, which `mcpKeys` cannot do: the adapter's `mcpValues` declares `JIRA_BASIC_AUTH` as a value derived from `JIRA_EMAIL` and `JIRA_TOKEN` (`DerivedKey`, `src/tracker/source.ts`), `trackerKeyRules` hands them to `keysOf` as `derived`, and a missing source key is reported by its own name. A session started by hand needs `JIRA_BASIC_AUTH` of its own. The MCP token and OAuth are in [`profiles.md`](profiles.md#jira-mcp-oauth-and-the-mcp-token).
- How to use it — `plugins/jira/README.md`.

### `forgejo` (BTN-476)

- The official Gitea MCP server `gitea-mcp` (checked against v1.13.0), a Go binary started over stdio (`-t stdio`). It takes the token from the environment (`GITEA_ACCESS_TOKEN`) and the host from `GITEA_HOST`, so the gateway fills both from the profile: `mcpKeys` from `FORGEJO_TOKEN`, `mcpValues` from `FORGEJO_URL` with its prefix (run live behind a path prefix, [verified](../verified/trackers.md)). Its Gitea SDK reads Forgejo's version string. `GITEA_SCOPES: issue,label,milestone,user` keeps the tool list to what a task needs; it has the dependency tools (`issue_write` `add_dependency`) the skill needs.
- The binary is not an npm package and Even Keel does not pin it: it must be on the service's `PATH` (`plugins/forgejo/README.md`). Its tools are method-style (`issue_write` with `method: delete_comment`), so `deletesRecord` reads a `method` field by its words and the protection group `deleteForgejo` refuses them at the gateway (`docs/sessions/protection.md`).
- How to use it — `plugins/forgejo/README.md`.

### `tasks` (BTN-768)

- Even Keel's own tasks server ([`tasks-server.md`](tasks-server.md)) with the skills `tasks:task` and `tasks:split`: the common part of `huly:task`/`huly:split` in terms of its five tools (`tasks_list`, `task_read`, `tasks_create`, `task_update`, `task_comment`), short since a skill sits in the context every turn. `.mcp.json` points at `http://127.0.0.1:4748/tasks`: for a package the gateway recognises the address (`isTasksUrl`, any port) and answers it itself; for a session started by hand it is the real address, with the project named by its key. It serves every tracker.
- **The default, not the only choice** (BTN-874). Where the page offers a tracker package, `tasks` comes first and the tracker's own plugin beside it with one line on how they differ: the tracker's own server has more tools and more context and works without the service; `tasks` has five tools, names instead of ids, and needs the service running. The tracker plugins keep their own servers, skills and hooks (`huly` stays on `@firfi/huly-mcp` with `check-marks.mjs`); for the brief either counts as the tracker's MCP ([`layer.md`](layer.md#the-brief)). Both on in one project is a warning on the page (`ProjectPackages.tracker.both`) with a button that turns `tasks` off, not a refusal: two tool sets of one tracker double the context, and the agent writes through one or the other. How the page offers them — `docs/packages/page.md`, "The tracker's package in two clicks".
- **On from the project's creation** (BTN-1028). A project added on a tracker the server serves gets `tasks` on as soon as its entry is written (`Packages.turnOnTasks`, from the `project` step of `creationPlan`), before the job waits for its packages: the catalog's `tasks@<marketplace>`, else another package that brings the `tasks` server, else the plugin added from Even Keel's marketplace and installed in the background, while the chain waits for it as for any package (`probing`). Nothing is turned on where a package of the set brings the server already. It is an ordinary package, not built in like `agent-bridge`: turned off or removed, it does not come back by itself. Projects added before it, and the demo project, keep their sets as they were.
- A session started by hand while the service is down: the plugin's `SessionStart` hook (`plugins/tasks/hooks/check-service.mjs`) asks the address of the plugin's `.mcp.json` and, on a refused or silent connection, tells the user and the agent that Even Keel's service is not running or is restarting and to reconnect with `/mcp` once it is up; any HTTP answer passes. A chain session (`EVEN_KEEL_URL` set) is not asked about.
- How to use it — `plugins/tasks/README.md`.
