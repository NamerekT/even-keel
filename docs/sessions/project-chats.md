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

The page's calls are `POST /api/chats/<name>` (`src/chats/routes.ts`): `list` (the project's active chats and its last choice), `archive` (a page of 20, newest first, `words` searched in the title, the first and last message and what the user wrote; `more` says an older page follows, no total), `chat` (an archived one too), `create`, `send` (text, answers and files in base64, up to 64 MB), `renew` (the same with the new chat's account, model and effort), `read`, `hide`.

Before the machine reports a session, a card with a recent user message shows `starting` for the usual session boot grace. In the window, sending moves the draft into the feed immediately. The chat keeps that bubble through the session ID arriving, a missing transcript and an empty first read. The recorded prompt replaces it on the first successful read that contains it. A failed send restores the draft, including its files.

## Going on in a new session

A message to a chat whose cache went cold or whose account is at its limit may go to a new chat instead (BTN-1232). The page asks (`chatRenewal` in `web/src/pages/chatRenewal.ts`): cold is the session's `coldReply` (without the session's view, the chat's state `cold`); a limit is the account's tightest window spent or the session's lamp `limit`, and it comes first. Not for a chat that works or starts, nor for one without a session. The window offers the project's last choice; at a limit, when that is the same spent account, the next open account of the chat's agent, else of any agent (`renewalChoice`).

`ProjectChats.renew` (`chats/renew`):

1. The files go into the folder's inbox and the text becomes `replyPrompt`, an open question's answers included, as for `send`.
2. The machine gives the old session's past (`MachineChats.past`: the monitor's `handoff` of the chat — its transcript path and recent feed lines); a failure leaves it out.
3. The old session is stopped (exception 12). A failed stop refuses the step and nothing changes.
4. The new chat is kept with `previous` (the old one) and `pending`, its whole first prompt (`renewPrompt`, `src/chats/prompt.ts`): a lead, the last 10 turns of the old chat taken from its feed without a model (the user's words and the agent's texts, each cut to 600 characters), the old transcript's path with "grep it, do not read it whole", then the message under `USER_MESSAGE_HEAD`, so the page shows it as the user's (BTN-1281). The old chat goes to the archive with the new one as its successor, and the new one becomes the project's last choice.
5. The new chat's session is launched with `pending`; once it is, `pending` is cleared. A failed launch clears it too and returns the error: the new chat stays, without a session, and the user's next message there starts it as any first message.

A restart between 4 and 5 loses nothing: the sweep finds an active chat with `pending` and no session and launches it with the same prompt, unless the machine already knows a session of the chat (`past`), which it then takes. An offline machine keeps it pending until the machine is back. A chat with `pending` and no session is `starting` for the page.

## The archive

- A chat goes to the archive a day after its last message or its session's last action, **in any state** — mid-turn or waiting on a question too (`ARCHIVE_AFTER_MS`). The service's sweep runs once a minute (`CHATS_SWEEP_MS`): it also keeps the title, the last message and the time of the last event, so the archive has them once the session's view is gone.
- "Hide" is the same archive; there is no delete, and the transcript stays on disk.
- On its way to the archive the session is stopped through its agent (exception 11 in `docs/chain/exceptions.md`). A failed stop refuses "Hide"; the day-old sweep archives anyway and logs it.
- An archived chat is only read: a message to it is refused (`chats.archived`); going on is a new chat. The chat a new session replaces goes to the archive with its successor (BTN-1232, exception 12).
- A restart loses nothing: the active chats are read back from the database, and their sessions are found again by name as the chain's are.

## The page

The Chats tab of the project page (BTN-1231) polls `list` every 4 s while the page is open, for its list and its badge; `archive` is asked per search and page, `create` from the "New session" window, `send` and `read` from the chat's window. A chat's window is the session's transcript window with the chat's field, without the commands menu; one without a session yet shows an empty feed. How it looks is in `docs/web/project-page.md` ("The Chats tab").

## In the stats

Tally reads each chat's session from the `chats` table and keeps it in `chat_sessions` (BTN-1233): such a session belongs to no task, even when its title names one, and `/stats` shows the chats' count and spend per project under the task table (`docs/tally.md` step 18, `docs/stats.md`).

## Not covered

Uncommitted changes a chat leaves in the main checkout hold up a chain task's merge the way a hand session's do from an editor: no guard of its own.
