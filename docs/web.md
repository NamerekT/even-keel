# The web page: interface, settings, setup

How the page is built and behaves, for the sessions that change it and the people who read it: the interface and its state, the project page and the session panel, the event log, language and messages, the settings pages, the first run and the project wizard, fake states and screenshots. How it looks is `docs/design.md`.

## Subtopics

The area is split by subtopic, a file each in `docs/web/`: read this table, then the whole file of your subtopic. A new section goes into the file of its subtopic; a new subtopic is a new file and a row here. Keep a file under ~30 KB, so that it is read whole.

| File | What is in it |
| --- | --- |
| [`interface.md`](web/interface.md) | The stack, the state stream and what it holds, routes and project names, busy marks, the app, the theme |
| [`header.md`](web/header.md) | The header and its account chip, the burger, the banners and "Got it", the tab badge, `/status`, updates |
| [`home.md`](web/home.md) | The home page: card order and grouping, test projects, empty projects, memes; the basement and the 404 |
| [`project-page.md`](web/project-page.md) | The project page: chain and backlog, motion, the task card, notices, the head, the side column |
| [`session-panel.md`](web/session-panel.md) | The session panel and the chat: the panel, turns, the composer, media and calls |
| [`event-log.md`](web/event-log.md) | The event log: what the service writes, toasts, unread, `/log` |
| [`hotkeys.md`](web/hotkeys.md) | Hotkeys: actions, the forms' Ctrl+S and Ctrl+Z with the draft's history, the window, storage by browser |
| [`language.md`](web/language.md) | Language and messages: the page's language, translation, message codes and their texts |
| [`config.md`](web/config.md) | Live config, what a save writes, the groups of the shared settings `/settings` |
| [`settings-forms.md`](web/settings-forms.md) | What both settings pages share: layout, inheritance marks, tables and selects, the draft and the save bar, token fields, the provider choice |
| [`project-settings.md`](web/project-settings.md) | Project settings: tabs, the locked tracker, task sources, the tracker block, chain rules, status moves, what the session gets, machines |
| [`milestones.md`](web/milestones.md) | Milestone order; the built-in tracker's milestone table and components |
| [`transfers.md`](web/transfers.md) | Moving a project off the built-in tracker and onto it; the "Transfers" reports |
| [`sign-in.md`](web/sign-in.md) | Sign-in to the page: who is asked, passkeys, the owner key, device tokens and their revoke |
| [`setup.md`](web/setup.md) | The first run's setup: its steps, the wizard frame, where it stopped |
| [`project-wizard.md`](web/project-wizard.md) | The project wizard: cards, the check, Claude Code's trust, a project without git, removal |
| [`wizard-repository.md`](web/wizard-repository.md) | The wizard's repository field, clones and folders; the creation job and its window |
| [`fake-states.md`](web/fake-states.md) | Fake states of `dev:fake` |
| [`screenshots.md`](web/screenshots.md) | Screenshots and motion frame sheets |

## Terms

Words the page's documents use without saying them again; the linked document has the whole story.

- **Hub** — the Even Keel instance that owns the chain, the state and the page; a **machine** runs sessions for it (`docs/machines.md`). The hub's **mirror** of a machine is its copy of that machine's page facts (`docs/machines/pool.md`, "The mirror").
- **Lane** — one place where a project's chain runs a task at a time; a project runs up to its `width` lanes across its machines (`docs/machines/pool.md`).
- **Held** — a task that holds a place (a worktree, a slot, a machine) while the dispatcher still has work on it after its session, such as a landing behind the chain (`docs/chain.md`). In the forms, a "held" value (`useHeld`) is what was sent, shown until the card is read anew.
- **Landing** — three things: a session's merge reaching the main checkout and the remote (`docs/chain/worktrees.md`); a task's place in the chain when it comes "Into the chain" (`docs/web/project-page/chain-and-backlog.md`); a settings save's values reaching the page (`useLanding`, `docs/web/settings-forms.md`, "The save bar").
- **Carry** — Even Keel merging a release project's branch forward into the branch its `mergeInto` names, by a carry session or "Carry now" (`docs/chain/projects.md`, "Carrying a release project forward").
- **Fix of main** — a `<KEY>-FIX` session the chain starts when the main branch's CI is red; the page tells the fixes apart as episodes `<KEY>-FIX.<n>` (`docs/chain/main-ci.md`).
- **Awaited push** — the chain's own push of the main branch whose CI verdict the watch waits for; a move to any other commit is a push from outside (`docs/chain/main-ci.md`). The **late watch** is the time-limited wait after a push no CI runner took (`MainCiView.late`, BTN-719, `docs/ci/layer.md`).
- **`gate.rerun`** — the kept mark that a rerun of a failed CI run was already asked for a commit (`docs/ci/workflows.md`).
- **Far rows** — the compact chain rows past the current task and the next three (`docs/web/project-page/chain-and-backlog.md`, "Tiers and the number").
- **Beat** — one step of a change's motion on the page, beats going in turn (`docs/web/project-page/motion.md`).
