# The Even Keel guide

The [README](../../README.md) says what Even Keel is and has the quick start. This guide is everything else, a page per area. Each page starts with what it covers and a list of its sections, and puts the rare cases last.

In every page `main` stands for the project's main branch, the one its **Main branch** setting names.

## Start here

The pages in the order a new installation meets them.

| Page | What is there |
| --- | --- |
| [Setting up](setup.md) | installing and the first start |
| [Projects](projects.md) | the wizard, the repository's folder or address, what a project needs, removing a project |
| [The built-in tracker](tracker-builtin.md) | tasks with no account, moving them to a real tracker and back |
| [Connecting a tracker](tracker-connect.md) | a tracker profile, what a session gets with and without the tracker's plugin |
| [Several trackers](tracker-several.md) | one project reading several trackers, CI, token permissions |
| [The page on other devices](remote.md) | answering from the phone, reaching the page from another machine, signing in |
| [The service](service.md) | npm, a clone, Windows, Linux and macOS; [a machine of a hub](hub-machine.md) |
| [Updating](updating.md) | from the page or by hand, plugins, stored state, going back; [uninstalling](uninstall.md) |
| [The CLIs it depends on](clis.md) | what Even Keel relies on in each agent's CLI, and the checked versions |
| [The chain](chain.md) | which tasks the chain takes, in what order and why one at a time, what happens to a task from its start to Done, unattended mode, projects without git, slots |
| [Chat and questions](chat.md) | answering a session's question, the transcript, writing while a session works, the chat's commands |
| [The page](page.md) | the project page and its legend, task cards, notices, the event log, the status screen, hotkeys, language and theme |

## Sessions and agents

| Page | What is there |
| --- | --- |
| [Sessions](sessions.md) | the model and effort of a task, prompts, the project's instructions and skills, standards, handoffs, what happens to a stopped session |
| [Agents](agents.md) | Claude Code, Codex, OpenCode and GitHub Copilot: which CLI version runs, how each is run, what the preview agents lack |
| [Accounts and limits](accounts.md) | adding accounts of a subscription, an API key or a cloud, how limits are read, what happens when one runs out |
| [Packages](packages.md) | plugins and MCP servers per project, pinned versions, the `tasks` package, your own skills |

## The project around the chain

| Page | What is there |
| --- | --- |
| [Trackers](trackers.md) | how each tracker's statuses, links and comments map onto the chain, several trackers for one project |
| [CI, pull requests and releases](ci.md) | a red main branch and its fix, a check without CI, PR mode, release branches, changelog drafts |
| [Statistics and the README badge](stats.md) | what sessions cost and where they got stuck, time reports, the badge of a project's chain |

## Safety

| Page | What is there |
| --- | --- |
| [Protection](protection.md) | the deny rules every session gets, what each agent enforces, your own rules |
| [Whose text a session reads](security.md) | who can steer a session through a task's text, what a session may do, setting up a public repository |

## Looking something up

| Page | What is there |
| --- | --- |
| [Reference](reference.md) | every environment variable and every setting with its default, the `protection` key, the task labels API for scripts |
