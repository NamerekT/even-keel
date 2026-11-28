# Packages

A package is a plugin or an MCP server. Even Keel keeps a set of them per project and gives it to chain sessions and the page's [project chats](chat.md#project-chats) at every launch: a pinned version, installed with one button and updated with another, while a running task stays on the version it started with. A package you turn on or off for the project reaches the next session of every task, a postponed one too.

The keys of packages, entered in the catalog, are kept in Even Keel's `.env`. MCP servers run behind a local gateway of Even Keel, so the keys never reach a session.

Installing a tracker's package for the first time is in [setup](tracker-connect.md#with-the-plugin).

- [Where packages are managed](#where-packages-are-managed)
- [Pinned versions](#pinned-versions)
- [Tracker servers and their profiles](#tracker-servers-and-their-profiles)
- [The `tasks` package](#the-tasks-package)
- [What other agents get](#what-other-agents-get)
- [Your own skills](#your-own-skills)

## Where packages are managed

Packages live in two places.

**Settings** → **Packages** is the catalog: adding a package, install, update, check (one or all), remove, whether it is on by default, the shared values of its settings and its keys.

![The shared settings at Packages: the package catalog with Check all, Update all and Add a package at its top, the packages grouped as Even Keel, claude-plugins-official and MCP servers, each row with its version, Update where a newer one is out and the switch of whether it is on by default; Tracker keys below](images/packages.webp)

**Project packages**, the wide button at the top of the **Sessions** tab of a project's settings, lists the packages turned on in it, or in amber the first problem among them. It opens the project's own set:

- a switch per package, with ↺ beside it when the project chose for itself — it puts back the catalog's default;
- the package's problems in this project;
- its settings for this project.

Packages are grouped by source — Even Keel's, other marketplaces, MCP servers — and the plugins of trackers the project does not use fold under "N more".

Package settings can be changed for every project (in the catalog) or for one project (in its packages). Settings you leave at their inherited value follow the package's defaults after an update; your changes stay. Reset a value to inherit it again. A running task keeps the defaults of its pinned version.

### The built-in `agent-bridge` plugin

The `agent-bridge` plugin is built in: every project has it from the first start, and its row shows a "built in" tag instead of the switches and **Remove**.

Handoffs, chat messages mid-turn, the check before a merge, standards and the badge's status line all run on its hooks. It puts nothing into a session's context until a hook has something to say, so each of these features is turned off by its own setting, not by the package.

**Update**, **Check** and its version work as for any package; after an update of Even Keel it needs no **Update**, as none of Even Keel's own plugins does ([Plugins](updating.md#plugins)).

### Project memory

A project's memory is the facts sessions save for later sessions of it. It lives in Claude Code's memory folder of the project, `~/.claude-memory/<project>`:

- Claude Code chain sessions use it as Claude Code's own memory, as the sessions you start yourself do.
- Codex and the other agents get it through the plugin's `memory` MCP server, which reads and writes the same files, and each session's prompt lists what the memory holds.
- A fact one session changed while another was working is not overwritten: the second session gets the new text and writes its change over it.
- Even Keel commits every change to a git repository of its own per project, in `state/even-keel/memory/`, so an old version can be brought back.
- A machine of a hub keeps copies of these folders over the link: each project of its pool, and any other folder there once you bind it to a project under **Other projects' memory** on the machine's page (a clone you work in by hand, say). Edits made while the machine is offline go to the hub when it is back; a folder neither in the pool nor bound is left alone.

## Pinned versions

An MCP server started as `npx -y <package>@<range>` is pinned with its whole dependency tree: Even Keel keeps the npm lock file next to the install, and an update that changes any dependency says how many in a notice (the list is in the log).

npm runs no install scripts of the package or its dependencies; a package that does not work without them has the **Install scripts** switch in its details, and the scripts then run as the service's user.

A server started any other way (`uvx`, `docker run`, `npx` without `-y`) fetches what it likes at every start: its row shows "version not pinned", and writing the command as `npx -y <package>@<version>` pins it.

## Tracker servers and their profiles

A tracker's MCP server connects with a tracker profile: the one the project picked, or, for a tracker that is only one of the project's [several task sources](tracker-several.md), the profile of its last source on that tracker; otherwise that tracker's default profile.

The profile supplies its whole set of connection fields: an optional address left blank uses the server's default, such as GitLab.com, even if the default profile points to a self-managed server. The GitHub, Linear and GitLab MCP servers use the profile's own token.

A Jira profile can connect Atlassian's MCP server through OAuth with one button instead of a separate MCP token; Even Keel keeps and refreshes that access, and the sessions never see it ([MCP through OAuth or a token](tracker-connect.md#jira-mcp-through-oauth-or-a-token)).

## The `tasks` package

The `tasks` package gives sessions Even Keel's own task tools, the same for every tracker: read a task and its comments, create tasks with their links, change fields and status, comment, and leave the handoff note. The project's statuses, labels and milestones come to the session from Even Keel, so it uses the right ones on any tracker.

A batch of tasks interrupted by a restart of the service can be repeated by the session without making duplicates. On GitHub, GitLab and Forgejo such a task carries a hidden marker at the end of its description, visible only when you edit its source; leave it there.

## What other agents get

- **Codex** sessions get the same set: the MCP servers, and of a plugin its skills and hooks (not its commands and agents), installed into each Codex folder on its first turn there and kept off for your own Codex sessions.
- **OpenCode** sessions get the MCP servers and a plugin's skills, plus the hooks of the plugins that bring OpenCode support: `agent-bridge` and Huly's do.

The chain does not start a task while a package of its project is not installed, lacks a key or does not answer. A server that does not answer is asked again by itself: while the project's chain runs, at least once a minute, and at once when you start or resume the chain.

Nor does it start a Codex task when Codex would not run a plugin's hooks (it checks that it trusts them first, and a new Codex version may change how): the session would go without the check before a merge and the context reminders. The page names the package; update Even Keel, or for now run the task on another provider.

## Your own skills

Your own skills need no package. Claude Code reads them from `~/.claude/skills`; Even Keel keeps them in `~/.claude-config/skills` (the same on every machine, [your Claude Code configuration](hub-machine.md#your-claude-code-configuration-on-every-machine)) and links each one into `~/.agents/skills`, where Codex, OpenCode and Copilot read them, so an edit of a skill reaches every agent at once. A skill of your own in `~/.agents/skills` stays as it is, and a link you made there to somewhere else too.

To delete a skill, delete it from `~/.claude/skills`, where you see it. Even Keel notices within seconds while it runs (or at its next start) and deletes the skill from `~/.claude-config/skills`: Codex, OpenCode and Copilot lose it at once, your other Claude accounts at their next launch, your other machines after their next sync. A skill deleted from `~/.claude-config/skills` goes the same way. The configuration's history keeps a deleted skill, so it can be brought back with git. Replacing the link in `~/.claude/skills` with a folder or a link of your own keeps the skill where it is.

A skill hidden from chain sessions — by **Hidden skills** under [Trim the tools](sessions.md#lean-sessions), or by `skillOverrides` in the project's `.claude/settings.json` — is hidden only in Claude Code sessions: Codex, OpenCode and Copilot chain sessions still see it. A skill that leans on Claude Code's own tools (Edit, `/rewind`, subagents) works poorly on another agent.
