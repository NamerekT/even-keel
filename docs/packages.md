# Packages (BTN-174, `src/packages/`)

What chain sessions get besides the CLI's own tools: plugins and MCP servers, as a set per project, given by flags at every launch. Even Keel keeps the packages, their versions and the keys; the settings files of the accounts and the repositories are not written. Sessions started by hand live by their own `settings.json` and `settings.local.json` and get none of this.

Service wiring lives in `src/service/account-packages.ts`: `wirePackages` connects the catalog and gateway to the service, and `briefOn` selects tracker briefing from the enabled servers. `src/service/accounts.ts` re-exports both entry points.

The class `Packages` (`service.ts`) keeps the catalog, the project sets, the pins and the gateways; a new install, the hub's install on a machine elsewhere and the npm steps are `Installs` (`installs.ts`), the seed and the repositories' `.mcp.json` offers `repo-reads.ts`.

## Subtopics

The area is split by subtopic, a file each in `docs/packages/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`files.md`](packages/files.md) | The file and the cache, `agent-bridge`, install and update, the user's skills in `~/.agents/skills`, keys |
| [`gateway.md`](packages/gateway.md) | The MCP gateway, the launch flags, the check before a launch |
| [`page.md`](packages/page.md) | The packages on the page |
