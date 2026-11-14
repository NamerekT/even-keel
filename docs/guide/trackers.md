# Trackers

The chain takes its tasks from a tracker: Huly, GitHub, GitLab, Linear, Jira Cloud, Forgejo or Even Keel's built-in one. Connecting a tracker and what each profile asks for is in [setup](setup.md#trackers-and-plugins). This page says how a tracker's statuses, links and comments map onto the chain, and how one project takes tasks from more than one tracker.

- [GitLab](#gitlab)
- [Jira Cloud](#jira-cloud)
- [Forgejo, Gitea and Codeberg](#forgejo-gitea-and-codeberg)
- [Several trackers for one project](#several-trackers-for-one-project)

## GitLab

GitLab Issues works on GitLab.com and self-managed servers too.

Opened issues enter by your required labels — the rest wait in the backlog —, closed issues are done, and native milestones and priority labels order the chain.

On GitLab Free there is no blocking order; Premium and Ultimate provide native blocking links.

Uploaded pictures and files from descriptions and comments appear on the task card, including in private projects; pictures appear in the text too. Files attached to a trusted answer in GitLab reach the session.

The profile and optional `gitlab:task` plugin use the same personal token ([setup](setup.md#trackers-and-plugins)).

GitLab CI pipelines and, in PR mode, merge requests are supported.

## Jira Cloud

Jira Cloud works through the site's REST API with an Atlassian API token.

Statuses go by their category: To Do is ready, In Progress is in progress, Done is done, and a status named Backlog stays out of the chain.

A Scrum project has no such status: its backlog is a board view, every To Do issue is ready, so keep the chain to chosen issues with a required label.

`Blocks` links order the chain, fix versions are its milestones (by release date, as the Releases page lists them, then number and name; for another order set the project's own milestone order) and priorities come from Highest…Lowest or your site's own scheme by its order.

Descriptions and comments show as Markdown, attached pictures and files appear on the task card, and files attached to an answer reach the session.

A task closes through the first transition its workflow offers to a Done status; a workflow without one leaves the task open and says so in the log.

Jira has no CI of its own: the CI and PR mode come from the repository's remote.

The optional `jira:task` plugin brings Atlassian's own MCP server on a separate MCP token or an OAuth connection ([setup](setup.md#trackers-and-plugins)).

Jira Data Center is not supported.

## Forgejo, Gitea and Codeberg

Forgejo Issues works on your own Forgejo or Gitea server and on Codeberg, through one profile that also reads the repository's Forgejo Actions and opens pull requests.

Open issues enter by your required labels, closed ones are done; the issues' native dependencies order the chain, and a repository with dependencies turned off goes by milestones and priority labels only.

Its task cards show no dependencies in either direction until dependencies are turned back on and the card is refreshed.

There are no subtasks. Only the comments of the repository's owner, its collaborators and the token's own account reach a session.

The optional `forgejo:task` plugin brings the official Gitea MCP server, which you install yourself ([setup](setup.md#trackers-and-plugins)).

## Several trackers for one project

A project's tasks can come from more than one tracker: its own, plus **task feeds** added in the project's settings, Tracker tab — say a private Huly project for your own work and the GitHub issues others file.

Each feed is a tracker, an account (profile) on it, a place (a repository, a team) and a key; the tasks of all feeds make one chain in the one repository.

A task keeps its tracker's id — Huly's, Linear's and Jira's own, GitHub's and GitLab's `<feed key>-<number>` — so each feed's key must give ids no other project or feed gives.

Blockers work only within one tracker; across them it is the order you set, then milestone, priority and number.

The Tracker tab lists the project's tracker and its feeds as **task sources**, each with a **Configure** window for its chain rules and milestones: a feed's task is judged by the feed's own rules over its profile's, never the project's, since its statuses and labels are another tracker's.

It is closed in its own tracker, and given to its session as text unless a package brings that tracker's MCP server signed in as the feed's account.

A feed whose tasks the chain has run keeps its account; removed, its recently closed tasks stay on the page for a week, and the stats keep linking them where they lived.

### GitHub issues taken into your tracker

If people report in your public GitHub repository while you keep the work in Huly or Linear, set **Take in GitHub issues with the label** in the project's settings, Tracker tab.

Every open issue of the project's GitHub remote with that label becomes a task of the project's tracker titled `#<number> <title>`, with a link back; you put the label on once you have read the issue, and only those with triage rights can.

Keep the label out of your issue templates: a template puts its labels on for any author, so the project page warns, naming the template, while one of the main branch does.

The same goes for the required labels of a GitHub, GitLab or Forgejo source.

If an author who is not a collaborator changes the issue's title or description after the label went on, the issue is not taken in until you read it again, take the label off and put it back.

The issue's text and its author's comments go in marked as information, not instructions; comments of the repository's collaborators go in as they are; nobody else's are copied, so a stranger cannot steer the work.

When the task is done, the issue gets one line — "Fixed; it ships in v1.2.3", the version taken from the task's milestone and the repository's tags — and Even Keel closes it when that release is published.

Two projects on one repository take different labels, for example the fixes of the released version and the next one.

The GitHub profile's token needs **Issues: Read and write**.
