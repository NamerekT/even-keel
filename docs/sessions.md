# Sessions, models, prompts, limits

Reference for sessions: how Even Keel launches the agents (Claude Code, Codex, OpenCode, Copilot) and watches their sessions.

## Subtopics

The area is split by subtopic, a file each in `docs/sessions/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Aim to keep a file under 30 KB, so that it is read whole; one that grows past 40 KB (the docs size test refuses it) is cut by subtopic rather than squeezed.

| File | What is in it |
| --- | --- |
| [`agents.md`](sessions/agents.md) | The agent adapters and their contract; Claude folder trust; stopping a turn; the Claude CLI and transcripts: the daemon and the binary, live sessions, a silent turn, temporary model errors, the feed, questions, the reply, resuming |
| [`codex.md`](sessions/codex.md) | Codex: a turn, a project without git, the registry, the transcript, tool pictures, no Remote Control, limits, flags, the sandbox under the Windows service, no question tool |
| [`opencode.md`](sessions/opencode.md) | OpenCode: turns, the account and config, the transcript, a silent turn, the `agent-bridge` plugin, OpenCode on Copilot; what is left of the research |
| [`copilot.md`](sessions/copilot.md) | GitHub Copilot: the binary, a turn, paths, the transcript, MCP, hooks and folder trust, the monthly allowance, early CLI refusals; GitHub Copilot CLI (research) |
| [`protection.md`](sessions/protection.md) | Protection per agent; project rules for every agent; the merge check on Codex; project standards |
| [`models.md`](sessions/models.md) | Run profiles and the run of a task; model prompts; model lists; the model a session shows; the context window and the auto-compaction window; prompts |
| [`tools.md`](sessions/tools.md) | Session settings (`--settings`) and the "What sessions get" page |
| [`checkpoint.md`](sessions/checkpoint.md) | The checkpoint threshold: the note and the mark, the thresholds, calibration; the note kept with Even Keel (`handoff_write`) |
| [`memory.md`](sessions/memory.md) | The project memory: its repository, the hub's repositories, the mirror, the machines' copies, the `memory` MCP server; the global configuration shared into account folders (`~/.claude`) |
| [`chat.md`](sessions/chat.md) | The chat mailbox; the inbox socket; a reply to a cold session; permission dialogs; one-off turns |
| [`project-chats.md`](sessions/project-chats.md) | Project chats: a session without a task from the page, its machine and launch, its state for the page, going on in a new session, an idle session, the archive |
| [`limits.md`](sessions/limits.md) | Limits: Claude, ChatGPT (Codex and OpenCode), other agents, answers of plans we have no account for |
| [`cache.md`](sessions/cache.md) | Prompt cache lifetime; the cache trial; every agent's cache (research); keep-warm |
| [`sdk.md`](sessions/sdk.md) | The Agent SDK transport; Agent SDK and API keys (research); Agent SDK against `--bg` (research); Agent SDK against `--bg`, measured |
| [`cli-versions.md`](sessions/cli-versions.md) | Pinning the CLI versions (research); the checked CLI; the newest release (`cli: latest`) |
