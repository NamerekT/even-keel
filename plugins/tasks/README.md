# tasks

Even Keel's own tasks server for the sessions of projects on any of its trackers — the built-in one, Huly, GitHub, Linear, Jira, GitLab and Forgejo — with the `tasks:task` and `tasks:split` skills. The server is not a separate process: Even Keel's MCP gateway answers it in the service, over the tracker layer, so it works only while Even Keel runs.

Outside the built-in tracker the tools have a few limits: a description patch reads and writes the whole description with no lock in between, so an edit made in the tracker at that moment is lost, and a comment does not carry the session's model. What a tracker cannot hold is refused with a reason, never skipped quietly:

- Huly: a parent is set only on a new task; a table in a description comes back as HTML. The `huly` plugin keeps its own server for now.
- GitHub: no "relates" link; a priority is a `priority: <level>` label the repository must already have.
- Linear: a milestone name found in two projects of the team is refused.
- Jira: a status moves only along the workflow; every issue keeps a priority, so "none" is refused; a sub-task takes no children.
- GitLab: one link per pair of issues; blocking links only on Premium and Ultimate; a priority is a `priority::<level>` label the project must already have.
- Forgejo: no subtasks and no "relates" link; blocking links need the repository's dependencies on; a priority is a `priority/<level>` label the repository must already have.

Every limit in detail: [`docs/trackers.md`](../../docs/trackers.md), "The tasks server".

| Tool | What it does |
| --- | --- |
| `tasks_list` | one line per task: key, status, milestone, title; open tasks unless `status` says otherwise; every tracker of the project, `tracker` narrows it to one |
| `task_read` | Markdown: a short head with the description revision, the description, comments on request |
| `tasks_create` | a batch of tasks with every field at once; links inside the batch as `#1`, `#2`; `retry` makes a repeat safe; `tracker` picks another tracker of the project |
| `task_update` | any fields at once; labels and links by `add`/`remove`; the description by `replace` patches, `append` or whole with `rev` |
| `task_comment` | a comment |

Nothing is deleted. Labels and milestones that do not exist are refused with the list of the existing ones, never created.

Each tracker has a `chain:` line of its roles: the status that puts a task into the chain, the label the chain skips, the question label, the milestones and whether it keeps a priority and an estimate — `chain: into it — Todo; skip — Manual; question — Question; milestones v0.3; priority: yes; estimate: no`. It is built from the chain rules the tracker's tasks are judged by, so it stays true when a project puts tasks into the chain by another status. A tracker without blocking links (GitLab Free) adds `blocking links: no`, and its `blocks` and `blockedBy` are refused before anything is written. A chain session gets it in its prompt, `task_read` under the card's head, a refused name at the end of the refusal. A tracker that gives no vocabulary says so, and its statuses, labels and milestones are refused.

`estimate` is minutes of the agent's own work (5, 10, 20, 40, 80); the tools convert it into the tracker's unit: Huly's hours, the built-in tracker's minutes, Jira's original estimate, GitLab's time estimate, the points of a Linear team's scale. GitHub, Forgejo and a Linear team with estimates off keep none and refuse it. The plugin's hook shows the project's "estimate → actual" medians before a `tasks_create` or `task_update` with an estimate, once a session, as the `huly` plugin does.

A project with task feeds has several trackers, told apart by the prefix of their task keys. A call on a task goes to the tracker of its key; `tasks_create` creates in the tracker of the session's own task, or the one `tracker` names. A link or a parent across two trackers is refused before anything is created. A tracker that does not answer leaves a line `<prefix>: unreachable, not searched` at the end of `tasks_list`, so a short list is never taken for a full one.

## Chain sessions

Turn the package `tasks@even-keel` on in the project's packages on Even Keel's page. A session gets the server through the gateway with its project and task in the address; its own task stays in the prompt (the brief), so it never reads it again.

## Sessions started by hand

The plugin's `.mcp.json` points at `http://127.0.0.1:4748/tasks`, the gateway's default port (`EVEN_KEEL_MCP_PORT`): the calls name the project by its key. Another port — edit the address. The gateway takes only requests from this machine with no browser `Origin`.
