# Trackers and plugins

Reference for sessions: how the tracker layer, the adapters and the Claude Code plugins are built. The working rules are in `CLAUDE.md`, the public description in `README.md` and `docs/guide/setup.md`.

## Subtopics

The area is split by subtopic, a file each in `docs/trackers/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

`layer.md` is the contract: each capability with how Huly, GitHub and Linear do it. Jira, GitLab and Forgejo are in `adapters.md`, the built-in tracker in its own files, and what belongs to one tracker alone in that tracker's file.

| File | What is in it |
| --- | --- |
| [`layer.md`](trackers/layer.md) | Terms (kind, place, reader, status categories), the neutral task model, the adapter contract and each capability: `brief`, `complete`, `children`, `card`, questions in the tracker, `create`, `closingRef`, milestones (`setMilestone`, `milestoneTasks`), `vocabulary`, `closedPage`, `logTime` |
| [`link.md`](trackers/link.md) | The connection and poll of a profile, a tracker that did not answer, writing task labels, moving a task to a chosen status, writes of the tasks server, contract tests on live trackers |
| [`profiles.md`](trackers/profiles.md) | Profiles: one tracker account, the default, checks, turning off, the import from `.env`, Jira's MCP token and OAuth |
| [`huly.md`](trackers/huly.md) | The Huly adapter: the client, threads, keys; its capabilities are in `layer.md` |
| [`github.md`](trackers/github.md) | The GitHub Issues adapter and taking GitHub issues in |
| [`adapters.md`](trackers/adapters.md) | The Linear, GitLab Issues, Jira Cloud and Forgejo Issues adapters |
| [`builtin.md`](trackers/builtin.md) | The built-in tracker: the model, tasks, journal, history, components, milestones, attachments |
| [`copy.md`](trackers/copy.md) | The copy of the built-in tracker into another tracker and the switch to the copy's target |
| [`import.md`](trackers/import.md) | Reading a project's whole history and the import into the built-in tracker |
| [`tasks-server.md`](trackers/tasks-server.md) | The tasks server (`src/taskmcp/`): the tools, their limits on each tracker |
| [`plugins.md`](trackers/plugins.md) | The Claude Code plugins of the trackers |
