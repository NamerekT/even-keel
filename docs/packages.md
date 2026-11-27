# Packages (BTN-174, `src/packages/`)

What chain sessions get besides the CLI's own tools: plugins and MCP servers, as a set per project, given by flags at every launch. Even Keel keeps the packages, their versions and the keys; the settings files of the accounts and the repositories are not written. Sessions started by hand live by their own `settings.json` and `settings.local.json` and get none of this.

## Terms

- **Package** — one plugin or one MCP server in Even Keel's catalog.
- **Package set** — the packages on in a project.
- **Install** — one installed version of a package, `state/packages/<package>/<install id>/`; the last one is current.
- **Pin** — the install of each package a task runs on, so a running task keeps its versions.
- **Cell** — a package in one project, with its problems.
- **Seed** — the first catalog, made from what sessions got before Even Keel kept packages.
- **Route** — a server's address in the gateway, `/mcp/<project GUID>/<package>@<install id>/<server>`.
- **Bridge** — the gateway's child process of a stdio server, one per MCP session.
- **Probe** — an `initialize` sent through the gateway to see that a server answers.
- **Grant** — an MCP OAuth grant of a tracker profile (`docs/trackers/profiles.md`).
- **Hub** — the main Even Keel service that machines connect to; a *machine elsewhere* is one on another host (`docs/machines.md`). *The hub's brief to a machine* is what the hub sends it about the chain and the packages (`HubBrief`) — not the setting `brief`, which puts the task's description into the prompt or leaves it to the tracker's server.
- **Holds, pauses** — a problem *holds* a project: no launch until it is gone, by itself. A problem only the user fixes *pauses* the chain with a notice ("The check before a launch" in `gateway.md`).

## The code

- `Packages` (`src/packages/service.ts`) keeps the catalog, the project sets, the pins and the gateways.
- `Installs` (`installs.ts`) makes installs: a new install, a machine elsewhere installing what the hub installed, and the npm steps.
- `repo-reads.ts` makes the seed and the offers of the repositories' `.mcp.json`.
- `wirePackageHub` (`src/service/account-packages.ts`) connects the catalog and the gateway to the service; `briefOn` there resolves the setting `brief` of a project: its own value, else on unless the set brings the tracker's server (or the tasks server for a tracker it serves).

## Subtopics

The area is split by subtopic, a file each in `docs/packages/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`files.md`](packages/files.md) | The file and the cache, lost installs, `agent-bridge`, install and update, the user's skills in `~/.agents/skills`, keys, upgrades from older versions |
| [`gateway.md`](packages/gateway.md) | The MCP gateway, the launch flags per agent, the check before a launch |
| [`page.md`](packages/page.md) | The packages on the page: the catalog, a project's packages, adding, the tracker's package |
