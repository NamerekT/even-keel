# tasks

Even Keel's own tasks server for the sessions of projects on its built-in tracker, with the `tasks:task` and `tasks:split` skills. The server is not a separate process: Even Keel's MCP gateway answers it in the service, over the tracker layer.

| Tool | What it does |
| --- | --- |
| `tasks_list` | one line per task: key, status, milestone, title; open tasks unless `status` says otherwise |
| `task_read` | Markdown: a short head with the description revision, the description, comments on request |
| `tasks_create` | a batch of tasks with every field at once; links inside the batch as `#1`, `#2`; `retry` makes a repeat safe |
| `task_update` | any fields at once; labels and links by `add`/`remove`; the description by `replace` patches, `append` or whole with `rev` |
| `task_comment` | a comment |

Nothing is deleted. Labels and milestones that do not exist are refused with the list of the existing ones, never created.

## Chain sessions

Turn the package `tasks@even-keel` on in the project's packages on Even Keel's page. A session gets the server through the gateway with its project and task in the address; its own task stays in the prompt (the brief), so it never reads it again.

## Sessions started by hand

The plugin's `.mcp.json` points at `http://127.0.0.1:4748/tasks`, the gateway's default port (`EVEN_KEEL_MCP_PORT`): the calls name the project by its key. Another port — edit the address. The gateway takes only requests from this machine with no browser `Origin`.
