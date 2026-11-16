# The project memory

Part of [`docs/sessions.md`](../sessions.md).

## Records instead of files (BTN-1029)

A chain session reads and writes the project memory through Even Keel's `memory` MCP server, never through the agent's own memory files: on the hub and on a machine (BTN-137), for every agent. Sessions started by hand on the hub keep the CLI's file memory in `~/.claude-memory/<project>` (`sharedMemory`, `docs/accounts.md`), and the hub mirrors that folder into the records and back.

- **Where the server comes from.** The built-in plugin `agent-bridge` brings it in its `.mcp.json` (`http://127.0.0.1:4748/memory`), so every project's set has it; it is not in the `tasks` plugin, since a project may have no tasks server. A session reaches it like any package server, through the MCP gateway (`docs/packages.md`), with `?task=<task>` on its address so that what it writes carries the task.
- **Who answers.** Only the hub's gateway (`McpGateway`, `isMemoryUrl`): a machine publishes no route of its own and relays the call to the hub over the link, as `hub.servers()` lists the memory routes among the hub-owned ones (`Packages.hubServers`, `docs/machines.md`). A machine's gateway asked directly answers 404.
- **What a session gets.** When the project's set brings the server (`Packages.bringsServer(project, 'memory')`), the session's `--settings` has `autoMemoryEnabled: false` and no `autoMemoryDirectory` (`chainSettings`, `src/tools/panel.ts`): the CLI then drops its instructions to write memory files from its system prompt and loads no `MEMORY.md`, so nothing needs a hook to forbid file edits. The hub's `wireBriefed.prepare` puts in its place the server's tools and the index of the live records (`name — description`) into the prompt (`withMemory`, `PROMPTS.memory`, `memoryEmpty` when there are none); the index goes to a machine inside the carried brief. Without the server a session gets the shared folder as `autoMemoryDirectory`, as before.

## Tools

- `memory_list` — the index with each record's version.
- `memory_read(names)` — whole records with their versions.
- `memory_write(name, description, type, body, version?, distinct?)` — without `version` a new record, with the version `memory_read` gave a change of it. The type is the CLI's: `user`, `feedback`, `project`, `reference`.
- `memory_delete(name, version)`.

**A write carries the version the session read**, as the built-in tracker's edit does (`builtin/edit`). Each record has its own version; one SQL statement writes it under the condition that the stored version is the one given (`src/memory/store.ts`), so two machines writing the same record at once never both win. The refused one gets the record's current text and version in the answer of its own call, applies its change to it and writes again; nobody else is told and no other session is written to. A change of another record passes; a new record never conflicts, besides one under the name of a live record (refused with that record). A deleted record stays in the table as a mark, so that a write over a version it had is refused too.

**A new record close to an existing one** (two words of name and description in common, half of the shorter one's, `similarRecords`) is refused with the list of the close ones, so the session updates the old record instead of growing the index; `distinct: true` writes it anyway.

## The hub's folder

`MemoryMirror` (`src/memory/mirror.ts`), one step at a time per project:

- **Folder → records** (`pull`) before every call of the server and before the index goes into a prompt: a file changed since it was last mirrored (`file_hash`) is a new version of its record, as a hand edit wins; a file gone deletes its record; a name changed in a file's frontmatter follows the file. `MEMORY.md` is the index, never a record.
- **Records → folder** (`push`) after a session's write: the record's file (frontmatter `name`, `description`, `metadata.type`, then the body) and its line in `MEMORY.md` (`- [Title](file.md) — description`). A deleted record's file and line go. The person's own lines and headings of `MEMORY.md` stay; a changed description replaces only the text after the dash.
- A project the hub does not know has no folder (`folderOf` gives `null`) and is left alone.

Free-text lines of the hub's `MEMORY.md` that are no record's do not reach chain sessions: the prompt indexes only records.

## Not decided

The privacy of the memory on machines (open question 1 of BTN-1029): a machine gets every record of the project from the hub, while the memory may hold personal things and a machine may be a stranger's server or a container. To be decided once machines run.
