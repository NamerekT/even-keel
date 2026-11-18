# Sessions: project chats

A project chat (BTN-1229, the server side BTN-1230) is a session without a task that the user starts from the page to talk about the project. It runs like a hand session, not like a chain one; the chain never sees it. The page's chat list, its window and the handover to a new session are BTN-1231…1234.

## A chat and its session

- **The record.** `ProjectChats.create` (`src/chats/chats.ts`) makes a chat of a project with the user's choice: the account folder, the model and the effort. They never change: another choice is another chat, so its prompt cache stays the same. The choice becomes the project's offer for the next chat (`chat_choices`). A chat's id is `chat-<12 hex>`; it is also the name its sessions start under, so the session monitor finds them as it finds a task's (`sessionsByTask` takes a name `isChatName` gives) and the views carry it as `task`.
- **No process before the first message.** A created chat holds no session. The user's first message (`ProjectChats.send`) launches it through the machine of the project's folder; each later one goes into the same session.
- **The machine.** The project's folder is on the own machine when the project's pool has it or is empty, else on the first connected machine of the pool, in the folder that machine has for it (`placeOf`, `src/service/chats.ts`). The chat keeps that machine (`chats.machine_id`): every later call goes to it, and an offline machine refuses the message (`chats.noMachine`).
- **The launch** (`MachineChats.launch`, `src/service/machine-chats.ts`) is the chain's `launchIn` with nothing of the chain: the project's main checkout as the folder, no `--settings`, no packages, no "Trim the tools", no handoff note. So the session has the account folder's own plugins and MCP servers and the checkout's `.claude/settings*.json` and `.mcp.json`, as a session started by hand there. `daemons.prepare` shares the common configuration into the account folder first (`src/account/share.ts`), as before any launch. The project's protection, its main branch and the agent's execution mode are the chain's. Remote Control is the account's own setting (`remoteControlAtStartup`), so a Claude chat is in the Claude app signed in to the same account when the chain's sessions are.
- **A later message** (`MachineChats.send`) goes into the live session where its agent takes one (`Agent.reply`); otherwise, with the session not mid-turn, the session is stopped and resumed with it; mid-turn it is refused (`chats.busy`): a turn is never cut for a message. Files go into `.temp/inbox/` of the folder first (`chat.saveInbox`), and the prompt is `replyPrompt`, an answer to the session's open question included. A message while the first session still starts is refused (`chats.starting`).
- **Every call carries the whole choice.** The machine keeps nothing of a chat; the hub's record is the only one.

## Its state for the page

`ProjectChats.list`/`card` give a `ChatCard` (`src/chats/model.ts`): the title — the one the CLI wrote into the transcript (`custom-title`, `ai-title`, read by `MachineChats.title`; Claude only), until then the first message —, the agent, account, model and effort, the state, the context fill, the last message and whose it is (`user`, `agent`, `ask`), the time of the last event, whether the user has read it, and, archived, its successor.

The state (`stateOf`): `new` (no message yet), `starting`, `working`, `waiting` (a question, a permission dialog, a startup dialog), `answered` (the turn ended and the cache is warm), `cold` (the cache window passed; without one, five minutes after the last event), `error` (a limit or an error that is not a temporary refusal), `archived`. The active list puts the waiting chats first, then by the last event, newest first. A chat is unread while its last message is the agent's and came after the user last opened it (`chats/read`).

The page's calls are `POST /api/chats/<name>` (`src/chats/routes.ts`): `list` (the project's active chats and its last choice), `archive` (a page of 20, newest first, `words` searched in the title, the first and last message and what the user wrote; `more` says an older page follows, no total), `chat`, `create`, `send` (text, answers and files in base64, up to 64 MB), `read`, `hide`.

## The archive

- A chat goes to the archive a day after its last message or its session's last action, **in any state** — mid-turn or waiting on a question too (`ARCHIVE_AFTER_MS`). The service's sweep runs once a minute (`CHATS_SWEEP_MS`): it also keeps the title, the last message and the time of the last event, so the archive has them once the session's view is gone.
- "Hide" is the same archive; there is no delete, and the transcript stays on disk.
- On its way to the archive the session is stopped through its agent (exception 11 in `docs/chain/exceptions.md`). A failed stop refuses "Hide"; the day-old sweep archives anyway and logs it.
- An archived chat is only read: a message to it is refused (`chats.archived`); going on is a new chat. The chat a new session replaces goes to the archive with its successor (BTN-1232, exception 12).
- A restart loses nothing: the active chats are read back from the database, and their sessions are found again by name as the chain's are.

## Not covered

Uncommitted changes a chat leaves in the main checkout hold up a chain task's merge the way a hand session's do from an editor: no guard of its own.
