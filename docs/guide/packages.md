# Packages

Plugins and MCP servers are a set per project, kept by Even Keel and given to chain sessions by flags at every launch: a pinned version installed with one button, updated with another, while a running task stays on the version it started with.

A package you turn on or off for the project reaches the next session of every task, a postponed one too.

MCP servers run behind a local gateway, so the keys stay in Even Keel's `.env`.

Installing a tracker's package for the first time is in [setup](setup.md#with-the-plugin).

- [Where packages are managed](#where-packages-are-managed)
- [Pinned versions](#pinned-versions)
- [Tracker servers and their profiles](#tracker-servers-and-their-profiles)
- [The `tasks` package](#the-tasks-package)
- [What other agents get](#what-other-agents-get)
- [Your own skills](#your-own-skills)

## Where packages are managed

Packages live in two places.

**Settings → Packages** is the catalog: adding a package, install, update, check (one or all), remove, whether it is on by default, the shared values of its settings and its keys.

A project's own packages open from **Project packages**, the wide button at the top of the **Sessions** tab of its settings, which lists the packages turned on or, in amber, the first problem among them: a switch per package, with ↺ beside it when the project chose for itself (it puts back the catalog's default), its problems in this project, and its settings for this project.

Packages are grouped by source — Even Keel's, other marketplaces, MCP servers — and the plugins of trackers the project does not use fold under "N more".

Package settings can be changed for every project (in the catalog) or for one project (in its packages). Settings you leave at their inherited value follow the package's defaults after an update; your changes stay. Reset a value to inherit it again. A running task keeps the defaults of its pinned version.

### The built-in `agent-bridge` plugin

The `agent-bridge` plugin is built in: every project has it from the first start, and its row shows a "built in" tag instead of the switches and Remove.

Handoffs, chat messages mid-turn, the check before a merge, standards and the badge's status line all run on its hooks; it puts nothing into a session's context until a hook has something to say, so each of these features is turned off by its own setting, not by the package.

Update, Check and its version work as for any package.

## Pinned versions

An MCP server started as `npx -y <package>@<range>` is pinned with its whole dependency tree: Even Keel keeps the npm lock file next to the install, and an update that changes any dependency says how many in a notice (the list is in the log).

npm runs no install scripts of the package or its dependencies; a package that does not work without them has the **Install scripts** switch in its details, and the scripts then run as the service's user.

A server started any other way (`uvx`, `docker run`, `npx` without `-y`) fetches what it likes at every start: its row shows "version not pinned", and writing the command as `npx -y <package>@<version>` pins it.

## Tracker servers and their profiles

A tracker's MCP server uses the project's chosen profile, or the last task feed's profile for another tracker, otherwise that tracker's default profile.

The chosen profile supplies its whole set of connection fields: an optional address left blank uses the server's default, such as GitLab.com, even if the default profile points to a self-managed server.

The GitHub, Linear and GitLab MCP servers use the profile's own token.

A Jira profile can connect Atlassian's MCP server through OAuth with one button instead of a separate MCP token; Even Keel keeps and refreshes that access, and the sessions never see it ([setup](setup.md#trackers-and-plugins)).

## The `tasks` package

The `tasks` package lets sessions create and edit tasks through Even Keel.

A repeated creation batch can use the same `retry` key to recover progress after a service restart.

On GitHub, GitLab and Forgejo, new tasks carry a recovery marker in an HTML comment at the end of the description: it is hidden in the rendered task and visible when editing its source. Jira keeps it in an issue property.

Recovery on those four trackers checks the newest 25 tasks, so check the tracker before repeating an interrupted batch after many newer tasks, or after removing the marker.

A task found by its marker gets every field of the batch written again — labels, priority, milestone, parent, component, estimate and status — so a field changed by hand between the interruption and the repeat goes back to the batch's value.

On Jira, removing a link that is absent in the requested direction and type is refused, including when the same removal is repeated; read the task's current links before retrying.

Details and remaining limits are in the [adapter reference](../trackers.md#the-tasks-server-btn-768-srctaskmcp).

## What other agents get

Codex sessions get the same set: the MCP servers, and of a plugin its skills and hooks (not its commands and agents), installed into each Codex folder on its first turn there and kept off for your own Codex sessions.

OpenCode sessions get the MCP servers and a plugin's skills, plus hooks from plugins that bring OpenCode support: checkpoint and Huly do.

Huly refuses descriptions and comments whose inline code is inside another formatting mark, and shows the estimate calibration when setting an estimate, with one refusal and a retry when the estimate disagrees with the data.

The chain does not start a task while a package of its project is not installed, lacks a key or does not answer.

Nor does it start a Codex task when Codex would not run a plugin's hooks (it checks that it trusts them first, and a new Codex version may change how): the session would go without the check before a merge and the context reminders.

The page names the package; update Even Keel, or for now run the task on another provider.

## Your own skills

Your own skills (`~/.claude/skills`, Codex's skills folder) reach only their own agent; **Add a package → My skills** in **Settings → Packages** wraps the ones you tick into one plugin package, so Codex, OpenCode and Copilot sessions get them too, and an edit of a skill shows as an update of the package.

A skill that leans on Claude Code's own tools (Edit, `/rewind`, subagents) works poorly on another agent.
