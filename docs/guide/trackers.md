# Trackers

The chain takes its tasks from a tracker: Huly, GitHub, GitLab, Linear, Jira Cloud, Forgejo or Even Keel's built-in one. Connecting a tracker and what each profile asks for is in [Connecting a tracker](tracker-connect.md); one project on several trackers is in [Task feeds](tracker-several.md#task-feeds). This page says how the statuses, links and comments of GitLab, Jira and Forgejo map onto the chain, and how GitHub issues come into another tracker.

The other trackers have their mapping next to their plugin: [Huly](../../plugins/huly/README.md), [GitHub](../../plugins/github/README.md), [Linear](../../plugins/linear/README.md); the built-in tracker is in [its own page](tracker-builtin.md).

- [GitLab](#gitlab)
- [Jira Cloud](#jira-cloud)
- [Forgejo, Gitea and Codeberg](#forgejo-gitea-and-codeberg)
- [GitHub issues taken into your tracker](#github-issues-taken-into-your-tracker)

## GitLab

GitLab Issues works on GitLab.com and self-managed servers too.

- **Entry.** Open issues enter by your required labels, the rest wait in the backlog; closed issues are done. Set **Required labels** to keep issues nobody has looked at yet out of the chain, above all in public projects.
- **Order.** Native milestones and priority labels order the chain. GitLab Free has only related links, so no blocking order: the chain follows milestones and priority. Premium and Ultimate provide native blocking links. Text such as `blocked by #12` is ignored.
- **Files.** Uploaded pictures and files from descriptions and comments appear on the task card, in private projects too; pictures appear in the text. Files attached to an answer from someone the project trusts ([Whose text a session reads](security.md#github-gitlab-and-forgejo)) reach the session.
- **CI.** GitLab CI pipelines and, in PR mode, merge requests are supported.

The profile and the optional `gitlab@even-keel` plugin use the same personal token ([the profile](tracker-connect.md#gitlab)).

## Jira Cloud

Jira Cloud works through the site's REST API with an Atlassian API token. Jira Data Center is not supported.

- **Statuses** go by their category: To Do is ready, In Progress is in progress, Done is done, and a status named Backlog stays out of the chain. A Scrum project has no such status: its backlog is a board view and every To Do issue is ready, so keep the chain to chosen issues with a required label or the project's own active statuses.
- **Blockers** are `Blocks` links. If your site renamed or deleted that link type, the profile's projects do not start until a link type of that name is back.
- **Milestones** are fix versions, ordered by release date as the Releases page lists them, then by number and name; for another order, set the project's own milestone order.
- **Priorities** come from Highest…Lowest or your site's own scheme, by its order.
- **Text and files.** Descriptions and comments show as Markdown, attached pictures and files appear on the task card, and files attached to an answer reach the session.
- **Closing.** A task closes through the first transition its workflow offers to a Done status; a workflow without one leaves the task open and says so in the log.
- **New tasks** Even Keel creates get the standard Task type, found by its original name, or else the first standard type the project has; epics and subtasks are never used.

Jira has no CI of its own: the CI and PR mode come from the repository's remote. The optional `jira@even-keel` plugin brings Atlassian's own MCP server on a separate MCP token or an OAuth connection ([MCP through OAuth or a token](tracker-connect.md#jira-mcp-through-oauth-or-a-token)).

## Forgejo, Gitea and Codeberg

Forgejo Issues works on your own Forgejo or Gitea server and on Codeberg, through one profile that also reads the repository's Forgejo Actions and opens pull requests.

- **Entry.** Open issues enter by your required labels, closed ones are done. Forgejo has no backlog, so keep the entry on a label.
- **Order.** The issues' native dependencies ("depends on") order the chain. A repository with dependencies turned off goes by milestones and priority only, and its task cards show no dependencies until you turn them back on and refresh the card. Text such as `blocked by #12` is ignored.
- **Priority** comes from labels `priority: high`, `priority/high` or `priority::high`.
- There are no subtasks and no estimates.

Whose issues and comments count is in [Whose text a session reads](security.md#github-gitlab-and-forgejo). The optional `forgejo@even-keel` plugin brings the official Gitea MCP server, which you install yourself ([the GitLab and Forgejo plugins](tracker-connect.md#the-gitlab-and-forgejo-plugins)).

## GitHub issues taken into your tracker

If people report in your public GitHub repository while you keep the work in Huly or Linear, set **Take in GitHub issues with the label** in the project's settings, **Tracker** tab. The GitHub profile's token needs **Issues: Read and write**.

1. You read a new issue and put the label on it; only people with triage rights can.
2. Every open issue of the project's GitHub remote with that label becomes a task of the project's tracker titled `#<number> <title>`, with a link back.
3. When the task is done, the issue gets one line — "Fixed; it ships in v1.2.3", the version taken from the task's milestone and the repository's tags — and Even Keel closes it when that release is published.

Keep the label out of your issue templates. Which comments are copied and what an outsider's edit after the label does is in [Whose text a session reads](security.md#github-gitlab-and-forgejo). Two projects on one repository take different labels, for example the fixes of the released version and the next one.
