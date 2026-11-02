# Sessions, models, prompts, limits

Reference for sessions: how Even Keel launches `claude` and watches it.

## Subtopics

The area is split by subtopic, a file each in `docs/sessions/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`agents.md`](sessions/agents.md) | Agent adapters; Stopping a turn; CLI and transcripts |
| [`codex.md`](sessions/codex.md) | Codex |
| [`opencode.md`](sessions/opencode.md) | OpenCode; OpenCode (research) |
| [`copilot.md`](sessions/copilot.md) | GitHub Copilot; GitHub Copilot CLI (research) |
| [`protection.md`](sessions/protection.md) | Protection; Project rules for every agent; The check before the merge; Project standards |
| [`models.md`](sessions/models.md) | Run profiles; Model lists; Context window; Prompts |
| [`tools.md`](sessions/tools.md) | Extra tools |
| [`checkpoint.md`](sessions/checkpoint.md) | Checkpoint threshold |
| [`chat.md`](sessions/chat.md) | Chat mailbox; Permission dialogs; One-off turns |
| [`limits.md`](sessions/limits.md) | Limits; Limits of OpenCode and Copilot |
| [`cache.md`](sessions/cache.md) | Prompt cache lifetime; Every agent's cache (research); Keep-warm |
| [`sdk.md`](sessions/sdk.md) | The Agent SDK transport; Agent SDK and API keys (research); Agent SDK against `--bg` (research); Agent SDK against `--bg`, measured |
| [`cli-versions.md`](sessions/cli-versions.md) | Pinning the CLI versions (research); The checked CLI |
