# Connecting a tracker

A tracker other than the built-in one is connected in two layers. The first is a **tracker profile**: Even Keel itself signs in with it, reads the tasks, hands each to a session and closes it. The second, optional, is a **tracker package**: it gives the sessions tools of their own to read and write the tracker.

- [Minimum: a profile only](#minimum-a-profile-only) — what each tracker's profile asks for, and what you do not get without a package
- [With the plugin](#with-the-plugin) — the `tasks` package or the tracker's own plugin
- [Jira: MCP through OAuth or a token](#jira-mcp-through-oauth-or-a-token)
- [Sessions you start by hand](#sessions-you-start-by-hand)

## Minimum: a profile only

Even Keel reads the tasks itself, puts the title and description of the task into the session's prompt, and closes the task when its branch lands in `main`.

You add a **tracker profile** on `/settings` → **Trackers and CI** → **Add profile**, and nothing else: pick the tracker, fill in its fields, and press **Check and save**.

- Even Keel checks the account and saves the profile if the check succeeds; an error leaves the dialog open without saving.
- **Check** alone shows whom the profile signs in as, without saving.
- A warning that another profile has the same account stops the save; press **Check and save** again to accept it.

![The "Add Forgejo profile" dialog after "Check": the token's rights for the tracker, the CI and pull requests, the server address and the hidden token filled in, "Signed in as johndoe" under the token, the profile name taken from the account, and "Back", "Cancel", "Check" and "Check and save" at the foot](images/tracker-profile.webp)

The page never shows a saved token or password again. Profiles live in Even Keel's state database on your machine, not in git.

Each project then names its place in that tracker in the wizard or on its **Tracker** tab. What each tracker's profile and project ask for:

### Huly

The server address, the workspace, and the e-mail and password of a separate Huly account with access to the projects — create one for Even Keel.

A token instead only if your Huly shows an API tokens page in the account settings: released self-hosted Huly has none, and its sign-in token comes from the e-mail and password anyway ([plugins/huly/README.md](../../plugins/huly/README.md#credentials)).

The project key is the Huly project identifier (`ABC` for `ABC-12`).

Installed with npm, Even Keel does not carry Huly's client (about 20 MB): it installs it with npm into `state/huly-client` of the data folder once you have a Huly profile, which takes a minute or two the first time. Until then the profile's check says the client is being installed — press it again a little later — and `/status` shows the install, with **Retry** if npm failed; Huly projects wait for it. A clone has the client already.

### GitHub

A [fine-grained token](https://github.com/settings/personal-access-tokens/new) on the repositories, with the rights in [Token permissions](tracker-several.md#token-permissions). A fine-grained token covers one owner: a personal repository and an organization's need a profile each. The profile shows when its token expires.

The project names its repository in **Repository on GitHub**, such as `octo-org/abc`.

GitHub has no backlog, so keep entry to the chain on a label: put `ready` (or your own) into **Only tasks with labels** of the project's [chain rules](chain.md#chain-rules).

In a public repository an outsider's issue waits for **Into the chain**, and an outsider's comments never answer a session: who counts as the repository's own and what reaches a session is in [Whose text a session reads](security.md#github-gitlab-and-forgejo).

Details and the mapping of statuses, blockers, sub-issues and priorities: [plugins/github/README.md](../../plugins/github/README.md).

### Linear

A [personal API key](https://linear.app/settings/account/security) ([Token permissions](tracker-several.md#token-permissions)).

The project key is the team key (`ENG` for `ENG-12`). **Project in Linear** may narrow the team down to one Linear project, such as `Web app`, so two repositories of one team run as two projects, each on its Linear project; left empty, the project takes all of the team's issues.

Details and the mapping: [plugins/linear/README.md](../../plugins/linear/README.md).

### GitLab

A personal access token with the `api` scope, and optionally your server's web address (default `https://gitlab.com`, without `/api/v4`; a server under a path prefix keeps it, such as `https://example.com/gitlab`). The profile checks the account and shows the token expiry when the server exposes it.

Use GitLab.com or a self-managed GitLab 19.5 or later: those are the versions Even Keel was checked on, and older ones may build parent and child issues differently, so the chain may miss a subtask or close a parent too early.

The project names its full path, subgroups included, in **Project on GitLab**, such as `group/subgroup/project`; with the project key `APP`, issue `iid` 12 becomes `APP-12`.

How its issues, blocking links and milestones map onto the chain is in [Trackers](trackers.md#gitlab); whose issues and comments count, in [Whose text a session reads](security.md#github-gitlab-and-forgejo). Details: [plugins/gitlab/README.md](../../plugins/gitlab/README.md).

### Jira Cloud

The site address (`https://<site>.atlassian.net`), the e-mail of an Atlassian account that sees the projects and its [API token](https://id.atlassian.com/manage-profile/security/api-tokens), classic or with scopes ([Token permissions](tracker-several.md#token-permissions)).

The project key is the Jira project key (`ABC` for `ABC-12`). Tasks Even Keel creates there itself, such as the fix of a red main, are of Jira's standard **Task** type, or the first standard type the project has; never an epic or a subtask.

How its statuses, `Blocks` links and fix versions map onto the chain is in [Trackers](trackers.md#jira-cloud). Details: [plugins/jira/README.md](../../plugins/jira/README.md).

### Forgejo, Gitea and Codeberg

The server's web address (with its path prefix if it has one) and an access token with the rights in [Token permissions](tracker-several.md#token-permissions). The same profile serves the repository's issues, its Forgejo Actions and PR mode.

The project names its repository in **Repository on Forgejo**, such as `owner/name`; with the project key `APP`, issue 12 becomes `APP-12`.

How its issues, dependencies and priority labels map onto the chain is in [Trackers](trackers.md#forgejo-gitea-and-codeberg); whose issues and comments count, in [Whose text a session reads](security.md#github-gitlab-and-forgejo). Details: [plugins/forgejo/README.md](../../plugins/forgejo/README.md).

### What a profile alone does not give

Without a tracker package the session does not write to the tracker. What you do not get:

- **Postponing on a blocker.** The session cannot file a blocker for its task, so it cannot hand the task back and let the blocker run first. Blockers you link yourself still order the chain.
- **Question tasks.** A session that took a decision on its own while you were away cannot file a task with the question for you to answer later; it can only tell you in its final message.
- **Comments and decisions.** Nothing is written back: no closing comment, no decisions folded into the description, no new tasks for bugs found on the way.
- **Attachments and discussion.** The session sees only the title and the description.

### A tracker that does not answer

After a tracker read times out, Even Keel retries that read with an increasing delay, from 20 seconds to five minutes. Saving a changed profile clears the delay.

A profile whose server is down for a while — a test server you stopped, say — can be turned off with the switch at the end of its row:

- Even Keel then does not contact that server at all: its projects' tasks are not read, its CI is not watched, and the projects stay on the home page dimmed with **Turn on**.
- A profile with a chain running, paused or queued on it cannot be turned off until you stop the chain.
- Sessions you start by hand still get its values ([Sessions you start by hand](#sessions-you-start-by-hand)), unless you hide it from them.

Turning it on starts nothing: the chain's **Start** comes back once the tasks have been read again, so the chain never goes by a list from before. The same holds after any tracker outage: until its tasks are read again, **Start** reads them first.

## With the plugin

On top of the profile, a package gives the sessions the tracker's MCP server and a skill for working a task: the session reads the task and its attachments, records decisions in the description, files blockers and question tasks, creates new tasks, leaves a closing comment and merges.

There are two kinds of tracker package, and a project needs one of them:

- **`tasks@even-keel`, the default.** A new project gets it on as soon as it is added, installed in the background if the catalog lacks it; you turn it off or remove it like any other package. It is Even Keel's own tasks server:
  - five tools with short answers; statuses, labels and milestones by name; a description patched rather than resent; no deletes;
  - the same on every tracker, and on every tracker of the project when it [reads several](tracker-several.md): a session on a task from another tracker comments and files its blockers there, and a task search covers all of them;
  - its tools are the service's own, so a session you start by hand with the `tasks` plugin (`claude plugin install tasks@even-keel --scope project`, [`plugins/tasks/README.md`](../../plugins/tasks/README.md)) needs Even Keel running. When it is not, the session says so when it starts, and `/mcp` reconnects the server once the service is up.
- **The tracker's own plugin** (`huly@even-keel`, `github@even-keel`, `linear@even-keel`, `gitlab@even-keel`, `jira@even-keel`, `forgejo@even-keel`). The tracker's own MCP server with its skills: more tools and more context, and it works without the service. Take it instead of `tasks` when you want that tracker's full set or a particular server.

Wherever the page offers a tracker package, `tasks` comes first and the tracker's own plugin beside it. Turning both on in one project works but is not worth it: two tool sets of one tracker double the context and the agent writes through one or the other, so the project's packages warn about it, with **Turn off tasks** beside the warning.

Both kinds are Claude Code plugins; what reaches Codex, OpenCode and Copilot is in [What other agents get](packages.md#what-other-agents-get).

Even Keel offers its own plugins with no marketplace to add first:

1. **Add the package.** In **Settings → Packages** (the package catalog), press **Add a package**, choose **Plugin** and pick `tasks@even-keel` or the tracker's own plugin, for every project or one. Even Keel copies the plugin, installs a pinned version of its MCP server and gives both to every chain session at launch. A project turns a package on or off in its own packages ([Where packages are managed](packages.md#where-packages-are-managed)).

   For one project there is a shortcut: **Project packages** beside **Task description in the prompt** in the project's settings, or the **What sessions get** chip in the project's head while its tip says a tracker package is missing. Either opens the project's packages with the add dialog over them, `tasks@even-keel` and the project already picked.
2. **Keys.** The MCP server takes the credentials of the project's tracker profile: it runs behind a local gateway on `127.0.0.1:4748` (`EVEN_KEEL_MCP_PORT`), so the sessions never see them. Another key a package needs shows in the package's details in the catalog; until it is set the project's chain pauses with that reason and **Open the project's packages** beside it, and goes on by itself once the key is there.
3. **Nothing to switch off.** Once a package of the project brings the tracker's MCP server (`tasks@even-keel` counts), the prompt carries only the task ID and the session reads the task itself. That is **Task description in the prompt** left on **auto** in the project's **Sessions** settings: **on** always puts the title and description into the prompt, **off** never does, and the chain waits while no package of the project brings the server.

### Files of a task

With the `tasks@even-keel` package, a session reading a task gets the files of Huly, Jira, GitLab, Forgejo and Linear tasks and their comments downloaded into `.temp/task-files/<KEY>/`, as local paths to open; the task text stays readable either way.

- Linear also collects uploaded files linked in the description and comments; external attachment links stay links. Linear gives no file size, so each read downloads its files again.
- Files over **Attachment size limit, MB** are listed as `too large`, failed downloads as `file unavailable`.
- Two different files of one name get separate folders.

### The GitLab and Forgejo plugins

The GitLab plugin reads and writes issues and milestones on GitLab.com and self-managed servers, Free included. It cannot change GitLab's own parent and child links between issues.

The Forgejo plugin brings the official [Gitea MCP server](https://gitea.com/gitea/gitea-mcp), a single program rather than an npm package: Even Keel does not install it. Download `gitea-mcp` for your system from its releases and put it on the `PATH` of the account the service runs as; without it the plugin's MCP server cannot start.

## Jira: MCP through OAuth or a token

GitHub, Linear, GitLab and Forgejo profiles have nothing to set for MCP: their **MCP for sessions** box says the sessions use the token entered above. The Jira plugin is Atlassian's own Rovo MCP server and needs access of its own besides the profile's API token: in the Jira profile's **MCP for sessions** box choose OAuth or Atlassian's separate MCP token. One is enough, and the token is unused while OAuth is connected.

### OAuth

1. In the Jira profile's dialog, a new profile's too, press **Connect MCP through OAuth**. A window asks Atlassian for consent; Even Keel keeps the access and renews it by itself, and sessions still see only the gateway's address.
2. After the consent, press **Check and save**: an unsaved grant is lost when the dialog closes, and expires ten minutes after the consent was started. The dialog asks before closing with an unsaved grant.
3. **Check** verifies both the profile's API token and the MCP access, and that MCP reaches the profile's site.

The profile list then shows **MCP: connected through OAuth**. It connects to Rovo MCP v2; an older Jira MCP OAuth connection needs connecting again in the profile dialog.

**Where the page is opened.** Open it over HTTPS, directly or through a local proxy such as a Tailscale Service, or on `localhost` of the machine Even Keel runs on: a plain HTTP address of another machine is refused as a callback. With direct network access, sign in to the page before connecting and allow its cookies.

**Not on localhost.** Atlassian accepts the callback only on [its allowed domains](https://support.atlassian.com/security-and-access-policies/docs/available-atlassian-mcp-server-domains/); `localhost` is allowed by default. For any other address your Atlassian organization's admin adds the callback domain of your Even Keel page — the one in the callback address the dialog shows, not `auth.atlassian.com` — to the allowed domains: in Atlassian Administration, **Connectors → Atlassian MCP server → Add domain**; older screens call it **Rovo → Rovo MCP server → Domain settings** ([Atlassian's instructions](https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-mcp-server-settings/)). Then press **Connect MCP through OAuth** again.

**When it goes wrong:**

- **Access to this domain is restricted** on the consent page, with **Accept** disabled — the callback's domain is not allowed yet (above).
- **MCP: reconnect needed** in the profile's row — the access could not be renewed: open the profile and press **Connect again**.
- A warning that sessions will write as another person — Atlassian grants access to whoever is signed in to Atlassian in that browser. Saving is still allowed; if it was not on purpose, sign in to Atlassian with the right account and press **Connect again**.
- Any other failure shows on the page; the details are in the service log ([As a service](service.md#as-a-service)), with credentials redacted.

### A token

For a machine without a browser:

1. Ask your Atlassian organization's admin to enable **API token** authentication for the Atlassian MCP server in the organization's settings (Connectors → Atlassian MCP server → Authentication).
2. [Create an Atlassian MCP V2 token with all scopes](https://id.atlassian.com/manage-profile/security/api-tokens?autofillToken&appId=mcp-v2&selectedScopes=all) for the same e-mail and enter it in **Atlassian MCP V2 token (optional)** in the Jira profile. Leave it empty for projects without `jira@even-keel`.
3. **Check** requires that the token reaches the profile's site; if it does not, create the token again after enabling API token authentication.

Details: [plugins/jira/README.md](../../plugins/jira/README.md#plugin).

## Sessions you start by hand

Sessions you start by hand get no packages. For them, Claude Code needs this repository as a marketplace: **Accounts** offers **+ Even Keel marketplace** in the **Claude Code** card (it appears after adding a Claude Code account) while your default config (no `CLAUDE_CONFIG_DIR` set) does not know it; a check mark replaces the button once added. Its tip has both commands to copy, or run `claude plugin marketplace add <git URL or local path of this repository>` yourself.

Then install the tracker's plugin in the project, such as `claude plugin install huly@even-keel --scope project`.

The credentials go into the `env` of `~/.claude/settings.json`. Even Keel writes each tracker's **default profile** there itself, under its own variable names; a profile's **Hide from hand sessions** takes them out. A session started by hand never gets another profile. Some plugins' MCP servers read other names, which you add yourself:

| Tracker | Even Keel writes | You add for the plugin |
| --- | --- | --- |
| Huly | `HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` or `HULY_EMAIL` and `HULY_PASSWORD` | nothing |
| GitHub | `GITHUB_TOKEN` | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| Linear | `LINEAR_TOKEN` | `LINEAR_API_KEY` |
| GitLab | `GITLAB_URL`, `GITLAB_TOKEN` | `GITLAB_PERSONAL_ACCESS_TOKEN` (and `GITLAB_URL` for your own server) |
| Jira | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`, `JIRA_MCP_TOKEN` | `JIRA_BASIC_AUTH`, the base64 of `e-mail:MCP-token`, with the [Atlassian MCP V2 token](#a-token) |

The GitHub skill sets "blocked by" links through the [GitHub CLI](https://cli.github.com/), so `gh auth login` once. Everything else — troubleshooting, what the skills do — is in [plugins/huly/README.md](../../plugins/huly/README.md), [plugins/github/README.md](../../plugins/github/README.md), [plugins/linear/README.md](../../plugins/linear/README.md), [plugins/gitlab/README.md](../../plugins/gitlab/README.md) and [plugins/jira/README.md](../../plugins/jira/README.md).
