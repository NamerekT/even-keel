# Even Keel documentation

Three kinds of documents live here. Pick the one you came for.

## I use Even Keel

Go to [the guide](guide/README.md): installing, the chain, trackers, agents, accounts and every setting, a page per area. What Even Keel is and the quick start are in the [README](../README.md).

## How it is built

For contributors and coding agents. These documents are dense: they are written as a reference a session reads before it changes an area, not as an introduction. Read the one for your area; where it is the index of a folder, it says which file of the folder holds your subtopic.

| Document | Area |
| --- | --- |
| [chain.md](chain.md) | the chain: order, worktrees and slots, cleanup after Done, unattended mode, state files |
| [storage.md](storage.md) | the state database: owner, tables, schema steps, imports, backup |
| [trackers.md](trackers.md) | the tracker layer, its adapters, the Claude Code plugins |
| [ci.md](ci.md) | the CI layer, its adapters, polling |
| [sessions.md](sessions.md) | the agent CLIs, transcripts, models, prompt assembly, limits |
| [packages.md](packages.md) | plugins and MCP servers of a project's set, keys, the MCP gateway, launch flags |
| [accounts.md](accounts.md) | account folders, sign-in and switching |
| [web.md](web.md) | the interface, translation and message codes, live config, fake states for layout work |
| [design.md](design.md) | how the page looks: tokens, shared blocks, the check of a screen |
| [settings.md](settings.md) | every setting and the levels it is set at |
| [stats.md](stats.md) | the statistics page, its server and URLs |
| [badge.md](badge.md) | the README badge: state, drawing, pushes |
| [tally.md](tally.md) | the statistics collector and its database: sources, schema, views |
| [service.md](service.md) | the service on Windows, Linux and macOS |
| [releases.md](releases.md) | branches, trackers, how a version is released |

The rules every change follows are in [CLAUDE.md](../CLAUDE.md) at the root.

## Logs and posts

- [unverified.md](unverified.md) — behaviour that has never been checked live: what Even Keel assumes there and what to do if the assumption is wrong.
- [verified.md](verified.md) — the log of every live check: what was checked, where, when and with what result.
- [posts/](posts/) — posts with numbers from the statistics, each with the SQL behind it.
