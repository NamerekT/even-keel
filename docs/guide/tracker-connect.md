# Connecting a tracker with its adapter and plugin

The adapter alone, and the adapter with the Claude Code plugin.

## Minimum: the adapter only

Even Keel reads the tasks itself, puts the title and description of the task into the session's prompt, and closes the task when its branch lands in `main`.

You add a **tracker profile** on `/settings` → **Trackers and CI** → **Add profile**, and nothing else: pick the tracker, fill in its fields, and press **Check and save**.

Even Keel checks the account and saves it if the check succeeds; an error leaves the dialog open without saving.

**Check** alone shows whom the profile signs in as without saving.

A duplicate-account warning stops automatic saving; press **Check and save** again to accept it.

The page never shows a saved token or password again. Profiles live in Even Keel's state database on your machine, not in git.

What each tracker's profile asks for:

### Huly

The server address, the workspace, and the e-mail and password of a separate Huly account with access to the projects — create one for Even Keel.

A token instead only if your Huly shows an API tokens page in the account settings: released self-hosted Huly has none, and its sign-in token comes from the e-mail and password anyway ([plugins/huly/README.md](../../plugins/huly/README.md#credentials)).

The project key is the Huly project identifier (`ABC` for `ABC-12`).

Installed with npm, Even Keel does not carry Huly's client (about 20 MB): it installs it with npm into `state/huly-client` of the data folder once you have a Huly profile, which takes a minute or two the first time.

Until then the profile's check says the client is being installed — press it again a little later — and `/status` shows the install, with **Retry** if npm failed; Huly projects wait for it. A clone has the client already.

### GitHub

A [fine-grained token](https://github.com/settings/personal-access-tokens/new) on the repositories, with the rights in [Token permissions](tracker-several.md#token-permissions).

A fine-grained token covers one owner: a personal repository and an organization's need a profile each. The profile shows when its token expires.

A project names its repository: `{ "repo": "…", "tracker": "github", "github": "octo-org/abc" }`.

GitHub has no backlog, so keep entry to the chain on a label: `"chain": { "requiredLabels": ["ready"] }`.

In a public repository anyone with a GitHub account can open an issue, and a session gives its text to an agent that runs commands on your machine.

So an issue opened by someone who is not the repository's owner, a member of its organization or a collaborator never enters the chain by itself: without required labels it waits in the backlog until you press **Into the chain** on it, which puts the label `even-keel: approved` on it (only people with triage rights can label an issue); with required labels it needs one of them, like any other issue.

Until it has that label, a session's `tasks@even-keel` tools do not show it either: the task list only counts such issues, and reading one gives no title, description or files.

The issues of the repository's own people enter at once unless you set required labels: the wizard says so for a public repository, and the project page keeps saying it in a band, with **Rules** next to it, for as long as the repository is public and has no required labels — also when it was made public after the project was added.

For the same reason Even Keel reads only the comments of the repository's owner, the members of its organization, its collaborators and the token's own account — as an answer to a question, and in PR mode as a review or a comment on a pull request.

Anyone else's is skipped with a line in the service log; the task card on the page still shows it.

Details and the mapping of statuses, blockers, sub-issues and priorities: [plugins/github/README.md](../../plugins/github/README.md).

### Linear

A [personal API key](https://linear.app/settings/account/security) ([Token permissions](tracker-several.md#token-permissions)).

The project key is the team key (`ENG` for `ENG-12`); `"linear": "Web app"` narrows the team down to one Linear project: `{ "repo": "…", "tracker": "linear", "linear": "Web app" }`, so two repositories of one team run as two projects, each on its Linear project.

Details and the mapping: [plugins/linear/README.md](../../plugins/linear/README.md).

### GitLab

A personal access token with the `api` scope, and optionally your server's web address (default `https://gitlab.com`, without `/api/v4`; a server under a path prefix keeps it, such as `https://example.com/gitlab`).

Use GitLab.com or a self-managed GitLab 19.5 or later: those are the versions Even Keel was checked on, and older ones may build parent and child issues differently, so the chain may miss a subtask or close a parent too early.

The profile checks the account and shows the token expiry when the server exposes it.

Pick the project including subgroups: `{ "key": "APP", "repo": "…", "tracker": "gitlab", "gitlab": "group/subgroup/project" }`; issue `iid` 12 becomes `APP-12`.

Opened issues are ready, closed ones done; use **Required labels** to keep unread issues out, especially in public projects.

An issue opened by someone without Reporter access waits for **Into the chain** even without them, as on GitHub.

Only members with Reporter access or above and the token owner can answer sessions through comments.

**GitLab Free has only related links, so no blocking order**: the chain follows milestones and priority; Premium or Ultimate adds native blocking links. Text such as `blocked by #12` is ignored.

Details: [plugins/gitlab/README.md](../../plugins/gitlab/README.md).

### Jira Cloud

The site address (`https://<site>.atlassian.net`), the e-mail of an Atlassian account that sees the projects and its [API token](https://id.atlassian.com/manage-profile/security/api-tokens), classic or with scopes ([Token permissions](tracker-several.md#token-permissions)).

The project key is the Jira project key (`ABC` for `ABC-12`): `{ "key": "ABC", "repo": "…", "tracker": "jira" }`.

Statuses of the To Do category are ready and enter the chain, except one named Backlog; a board whose backlog is not a status needs **Required labels** or the project's own active statuses.

The chain is ordered by the `Blocks` link type: if your site renamed or deleted it, the profile's projects do not start until a link type of that name is back.

Details: [plugins/jira/README.md](../../plugins/jira/README.md); the live checks are in [verified.md](../verified/trackers.md).

### Forgejo, Gitea and Codeberg

The server's web address (with its path prefix if it has one) and an access token with the rights in [Token permissions](tracker-several.md#token-permissions).

The same profile serves the repository's issues, its Forgejo Actions and PR mode.

A project names its repository: `{ "key": "APP", "repo": "…", "tracker": "forgejo", "forgejo": "owner/name" }`; issue 12 becomes `APP-12`.

Open issues are ready, closed ones done; Forgejo has no backlog, so keep entry on a label with **Required labels**, and in a public repository an issue opened by anyone but the owner, a collaborator or the token's account waits for **Into the chain** even without one, as on GitHub; the wizard says so.

The chain is ordered by the issues' native dependencies ("depends on").

**A repository with dependencies turned off has no blocking order**: the chain then follows milestones and priority only, and text such as `blocked by #12` is ignored.

Priority comes from labels `priority: high`, `priority/high` or `priority::high`; there are no subtasks and no estimates.

Only comments of the repository's owner, its collaborators and the token's own account answer a session; anyone else's is skipped with a line in the service log.

Details: [plugins/forgejo/README.md](../../plugins/forgejo/README.md).

### What the adapter alone does not give

On this level the session does not write to the tracker. What you do not get:

- **Postponing on a blocker.** The session cannot file a blocker for its task, so it cannot hand the task back and let the blocker run first. Blockers you link yourself still order the chain.
- **Question tasks.** A session cannot file a `Question: …` task for a decision it took on its own; it can only tell you in its final message.
- **Comments and decisions.** Nothing is written back: no closing comment, no decisions folded into the description, no new tasks for bugs found on the way.
- **Attachments and discussion.** The session sees only the title and the description.

### A tracker that does not answer

After a tracker read times out, Even Keel retries that read with an increasing delay, from 20 seconds to five minutes.

Saving a changed profile clears the delay. Repeated timeouts produce one diagnostic line and a recovery line with their count in the service log.

A profile whose server is down for a while — a test server you stopped, say — can be turned off with the switch at the end of its row.

Even Keel then does not contact that server at all: its projects' tasks are not read, its CI is not watched, and the projects stay on the home page dimmed with **Turn on**.

A profile with a chain running, paused or queued on it cannot be turned off until you stop the chain.

Turning it on starts nothing: the chain's **Start** comes back once the tasks have been read again, so the chain never goes by a list from before.

Sessions you start by hand keep the default profile's values either way.

The same rule holds after any tracker outage: until its tasks are read again, **Start** reads them first.

## With the plugin

On top of the adapter, a Claude Code plugin from this repository gives the sessions the tracker's MCP server and a skill for working a task: the session reads the task and its attachments, records decisions in the description, files blockers and question tasks, creates new tasks, leaves a closing comment and merges.

There are two kinds of tracker package, and a project needs one of them:

- **`tasks@even-keel`, the default.** A new project gets it on as soon as it is added, installed in the background if the catalog lacks it; it is an ordinary package, which you turn off or remove like any other. Even Keel's own tasks server: five tools with short answers, statuses, labels and milestones by name, description patches instead of resending it, no deletes; the same on every tracker. Its tools are the service's own, so a session you start by hand with the `tasks` plugin needs Even Keel running — when it is not, the session says so when it starts, and `/mcp` reconnects the server once the service is up.
- **The tracker's own plugin** (`huly@even-keel`, `github@even-keel`, `linear@even-keel`, `gitlab@even-keel`, `jira@even-keel`, `forgejo@even-keel`). The tracker's own MCP server with its skills: more tools and more context, and it works without the service. Take it instead of `tasks` when you want that tracker's full set or a particular server.

Wherever the page offers a tracker package, `tasks` comes first and the tracker's own plugin beside it. Turning both on in one project works but is not worth it: two tool sets of one tracker double the context and the agent writes through one or the other, so the project's packages warn about it, with **Turn off tasks** beside the warning.

Even Keel offers its own plugins from this folder, with no marketplace to add first:

1. In **Settings → Packages** (the package catalog), press **Add a package**, choose **Plugin** and pick `tasks@even-keel` or the tracker's own plugin for every project or one. Even Keel copies the plugin, installs a pinned version of its MCP server and gives both to every chain session at launch. A project turns a package on or off in its own packages: the project's settings → **Sessions** → **Project packages** at the top of the tab, where each package has a switch and ↺ puts back the catalog's default. A plugin your projects already had enabled when you upgraded is in the catalog already. A shortcut for one project: **Project packages** beside **Task description in the prompt** in the project's settings, or the **What sessions get** chip in the project's head while its tip says a tracker package is missing, opens the project's packages with the add dialog over them, `tasks@even-keel` and the project already picked; while the project lacks a tracker package, its packages show a button for each kind.
2. The MCP server takes the credentials of the project's tracker profile: it runs behind a local gateway on `127.0.0.1:4748` (`EVEN_KEEL_MCP_PORT`), so the sessions never see them. Another key a package needs shows in the package's details in the catalog; until it is set the project's chain pauses with that reason and **Open the project's packages** beside it, and goes on by itself once the key is there.
3. Nothing to switch off: once a package of the project brings the tracker's MCP server, the prompt carries only the task ID and the session reads the task itself (`brief` left as auto). The package `tasks@even-keel` counts as that server too: a project with it on and the tracker's plugin off also gets only the task ID. `brief: true` or `false` overrides that; with `false` the chain waits while no package of the project brings the server.

With the `tasks@even-keel` package, `task_read` downloads files from Huly, Jira, GitLab, Forgejo and Linear tasks and their comments into `.temp/task-files/<KEY>/` and returns their local paths.

Linear also collects uploaded files linked in the description and comments; external attachment links stay links.

Files over **Attachment size limit, MB** are listed as `too large`, and failed downloads as `file unavailable`; the task text remains readable.

Linear does not provide a file size on the card, so repeated reads download its files again.

Two different files of one name get separate path prefixes. [Adapter details](../trackers/tasks-server.md#the-tasks-server-btn-768-srctaskmcp).

### The GitLab and Forgejo plugins

The GitLab plugin enables the `issues,milestones` toolsets: sessions read issues through REST `get_issue` on GitLab.com and self-managed servers, including CE/Free. Work-item tools are disabled because the pinned MCP version's GraphQL queries fail on CE/Free; native parent-child changes need a compatible work-item tool.

The Forgejo plugin brings the official [Gitea MCP server](https://gitea.com/gitea/gitea-mcp), a single program rather than an npm package: Even Keel does not install it.

Download `gitea-mcp` for your system from its releases and put it on the `PATH` of the account the service runs as; without it the plugin's MCP server cannot start.

### Jira: MCP through OAuth or a token

GitHub, Linear, GitLab and Forgejo profiles have nothing to set for MCP: their **MCP for sessions** box says the sessions use the token entered above.

In a Jira profile's box, choose OAuth or Jira's separate MCP token: one is enough, and the token is unused while OAuth is connected.

The profile list shows **MCP: connected through OAuth** or **MCP: reconnect needed**.

**Check** verifies both REST and the selected MCP OAuth access, refreshing it if necessary; Jira also checks that MCP can reach the profile's site.

Even Keel renews access automatically, so no short-lived token expiry is shown.

After browser consent, press **Check and save**: an unsaved grant is lost when the dialog closes and expires ten minutes after consent was started. The dialog asks before closing with an unsaved grant.

The Jira profile has **Connect MCP through OAuth** in its dialog, on a new profile too: a window asks Atlassian for consent, and Even Keel keeps the access and refreshes it; sessions still see only the gateway's address.

It connects to Rovo MCP v2 and requests the permissions its server advertises; an older Jira MCP OAuth connection needs connecting again in the profile dialog.

GitHub, Linear and GitLab have no OAuth connection: their MCP servers take the profile's token, and an OAuth connection saved by an earlier version is dropped.

Jira uses [Atlassian's OAuth domain rules](https://support.atlassian.com/security-and-access-policies/docs/available-atlassian-mcp-server-domains/): `localhost` is supported by default.

A custom HTTPS callback needs a matching allowed-domain rule. Without one, v2's consent page says **Access to this domain is restricted** and disables **Accept**, even though client registration succeeds.

Your Atlassian organization's admin adds the **callback domain of your Even Keel page** to the allowed domains, not the authorization server's `auth.atlassian.com` address; the rule must match the callback URL shown in the dialog.

In the current Atlassian Administration this is **Connectors → Atlassian MCP server → Add domain**; older screens call it **Rovo → Rovo MCP server → Domain settings** ([Atlassian's instructions](https://support.atlassian.com/security-and-access-policies/docs/control-atlassian-mcp-server-settings/)).

Then retry **Connect MCP through OAuth**.

Open the page over HTTPS, directly or through a local proxy such as Tailscale Service, or on `localhost` of the machine Even Keel runs on: a plain HTTP address of another machine is refused as a callback.

With direct network access, sign in to the page before connecting OAuth and allow its cookies.

The callback returns to the tracker settings without authorization parameters in the address, including when access is refused.

When access cannot be renewed, the profile's row says **MCP: reconnect needed**; open the profile and press **Connect again**.

Atlassian grants access to whoever is signed in to Atlassian in that browser: if it is another person than the profile's API token, the dialog and the profile's row warn that sessions will write as that person.

Saving is still allowed; if it was not on purpose, sign in to Atlassian with the right account and press **Connect again**.

The MCP token below remains the other way, for a machine without a browser.

If MCP OAuth fails to connect or renew, the service log names the tracker kind, the failed step and the provider's HTTP error or exception message.

The page shows the connection error; diagnostic details stay in the log, with credentials and callback values redacted. See [As a service](service.md#as-a-service) for the log location.

The Jira plugin is Atlassian's own Rovo MCP server and needs a separate token from the REST adapter (or the OAuth connection above).

First ask your Atlassian organization's admin to enable **API token** authentication for the Atlassian MCP server in the organization's settings (Connectors → Atlassian MCP server → Authentication).

Then [create an Atlassian MCP V2 token with all scopes](https://id.atlassian.com/manage-profile/security/api-tokens?autofillToken&appId=mcp-v2&selectedScopes=all) for the same e-mail and enter it in **Atlassian MCP V2 token (optional)** in the Jira profile.

Leave it empty for projects without `jira@even-keel`.

The profile check calls `getAccessibleAtlassianResources` and requires that it include the profile's site; if the list is empty or lacks the site, create the MCP token again after enabling API token authentication.

A successful tool listing alone does not prove access.

Details: [plugins/jira/README.md](../../plugins/jira/README.md#plugin).

### Sessions you start by hand

Sessions you start by hand get none of this.

For them, Claude Code needs this repository as a marketplace: **Accounts** offers **+ Even Keel marketplace** in the **Claude Code** card while your default config (no `CLAUDE_CONFIG_DIR` set) does not know it; a check mark replaces the button once added.

The card appears after adding a Claude Code account.

Its tip has both commands to copy, or run `claude plugin marketplace add <git URL or local path of this repository>` yourself.

Then `claude plugin install huly@even-keel --scope project` in the project and the credentials in the `env` of `~/.claude/settings.json` (`HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` or `HULY_EMAIL` and `HULY_PASSWORD`; `GITHUB_PERSONAL_ACCESS_TOKEN`; `LINEAR_API_KEY`; `GITLAB_PERSONAL_ACCESS_TOKEN` and optional `GITLAB_URL`; `JIRA_BASIC_AUTH`, the base64 of `e-mail:MCP-token`, using the separate Atlassian MCP V2 token).

Even Keel writes each tracker's default profile there itself; the GitHub, Linear, GitLab and Jira MCP variables above use different names, so supply those explicitly for sessions started by hand.

Such a session never gets another profile.

The GitHub skill sets "blocked by" links through the [GitHub CLI](https://cli.github.com/), so `gh auth login` once. Everything else — troubleshooting, what the skills do — is in [plugins/huly/README.md](../../plugins/huly/README.md), [plugins/github/README.md](../../plugins/github/README.md), [plugins/linear/README.md](../../plugins/linear/README.md), [plugins/gitlab/README.md](../../plugins/gitlab/README.md) and [plugins/jira/README.md](../../plugins/jira/README.md).
