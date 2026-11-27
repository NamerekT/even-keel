# Sessions: project chats

A project chat (BTN-1229, the server side BTN-1230) is a session without a task that the user starts from the page to talk about the project. It runs like a chain session without a task (BTN-1694); the chain never sees it.

## A chat and its session

- **The record.** `ProjectChats.create` (`src/chats/chats.ts`) makes a chat of a project with the user's choice: the account folder, the model and the effort. They never change: another choice is another chat, so its prompt cache stays the same. The choice becomes the project's offer for the next chat (`chat_choices`). A chat's id is `chat-<12 hex>`, and the views carry it as `task`.
- **Its session's name.** A Claude `--bg` chat starts without a name (`SessionStart.autoTitle`, BTN-1772), for under `-n` the CLI generates no title. `claude agents` lists such a session under floating names (the whole prompt, then a kebab form of the title), so:
  - the launch finds the session by the job `claude --bg` printed (`launchedJob`; a new job of the folder when none was printed), a resume's copy too;
  - the session monitor finds it by the machine's binding of sessions to chats first (`ChatSessions`, `src/sessions/chat-sessions.ts`, the `chatOf` of `sessionsByTask`): the machine binds the session of each launch and resume (`MachineChats`), and the hub hands back its active chats' sessions at each connection (`records.restore`, `docs/machines/seam.md`);
  - every other chat — Codex, Copilot, OpenCode, a Claude chat on the Agent SDK, and a Claude chat launched before BTN-1772 — starts under its id as its name and is found by it (`isChatName`).
- **No process before the first message.** A created chat holds no session. The user's first message (`ProjectChats.send`) launches it through the machine of the project's folder; each later one goes into the same session.
- **Every call carries the whole choice.** The machine keeps nothing of a chat; the hub's record is the only one.

### The machine

- **The candidates.** The "New session" window lets the user pick the machine (BTN-1614) among the project's candidates (`placesOf`, `src/chats/places.ts`): the pool's turned-on machines, the own one first; with an empty pool the own machine and every machine elsewhere with a folder of the project. Each candidate says why it cannot take a chat now: `offline` (off the link) or `noFolder`. The pick sits above the window's scrolling body (BTN-1670).
- **The last choice.** The machine the chat went to — `create`'s, and `renew`'s, the old chat's or the one its window picked (BTN-1711) — is part of the project's last choice (`ChatChoice.machine`, `chat_choices.machine_id`, BTN-1710). The window offers it first while it can take a chat, else the server's pick (`machineFirst`, `web/src/pages/chatMachines.ts`).
- **The accounts of the window.** A machine elsewhere's accounts come from its mirrored panel, each renamed after the hub's folder of the same e-mail (`hubFolderOf`, as `machineAccountView` names them). The window lists only those a session can start on (`chatOptions`): no `needsLogin` (a refused key included), a read status not signed out, not being removed — the own machine's too. One on a limit stays, greyed.
- **No machine named.** A chat created without a machine goes where it went before: the own machine when the pool has it or is empty, else the first connected machine of the pool (`pickedOf`).
- **The checks.** `placeOf` (deps in `src/service/chats.ts`) checks a machine named: outside the pool `chats.notInPool`, no folder `chats.noFolder`, off the link `chats.noMachine`. The folder is the one that machine has for the project.
- **The chat keeps it** (`chats.machine_id`, `ChatCard.machine`): the first message, a deferred relaunch and `renew` (unless its window picks another machine) all go to it, so its history and `past` stay where they are. An offline machine refuses the message (`chats.noMachine`).

### The launch

`MachineChats.launch` (`src/service/machine-chats.ts`) is a chain session without a task (BTN-1694): the chain's `launchIn`, on every agent.

- **The packages** are the project's, as a chain session gets them (`docs/packages.md`): plugins through `--plugin-dir`, MCP servers through the hub's gateway with `--strict-mcp-config` (`docs/packages/gateway.md`), keys behind the gateway. The account folder's own plugins and MCP servers and the checkout's `.mcp.json` stay out, as in the chain, so a chat has the same tools on any machine and an account's plugin is never doubled by a package.
- **Current installs, never a pin** (`Packages.chatStartOf`: a chat has no end a pin would wait for), with the chain's check of a lost install (`packages.lost`). `startOf` is rebuilt at every launch and resume, so a live chat takes a changed set or model at its next restart and keeps its history.
- **The tasks and memory servers** get their address without `?task=`, so a chat has no `handoff_write` and sees the tasks of every project, its own by default (BTN-1747, `docs/trackers/tasks-server.md`, "Scope"): a key of another project is read, updated and commented on as is, and `tasks_list`/`tasks_create` take that project's key as `project`.
- **What differs from the chain:** the project's main checkout as the folder, no "Trim the tools", no handoff note.
- **A Claude chat's `--settings`** is the chain's without the trim (`createChatSettings`, `src/tools/sessionSettings.ts`), so every skill stays: `promptCacheTtl` of an hour (BTN-1401, `docs/sessions/cache.md`), `enabledPlugins: false` for the plugins of the global `settings.json` and the chat folder's `.claude/settings*.json` the set does not bring, the packages' keys blank in `env`, the protection rules and the project's memory.
- `daemons.prepare` shares the common configuration into the account folder first (`src/account/share.ts`), as before any launch. The project's protection, its main branch and the agent's execution mode are the chain's.
- Remote Control is the account's own setting (`remoteControlAtStartup`), so a Claude chat is in the Claude app signed in to the same account when the chain's sessions are.

### A later message

`MachineChats.send` takes the order of a task chat's message to a working session (`docs/sessions/chat.md`, "The inbox socket"), and a turn is never cut for it (BTN-1345). It tries, in this order:

- the live session, where its agent takes one (`Agent.reply`: a live SDK session, mid-turn too);
- a Claude `--bg` session's inbox socket (`toldInbox`, `docs/sessions/chat.md`, "The inbox socket"), mid-turn or between turns, unless the session waits on a question or a permission dialog or is marked hung;
- mid-turn, the mailbox, when the session's hooks ask for mail (`Mailbox.listens`, the row under the chat's id; from the launch or resume on, before they first ask, BTN-1430). An OpenCode, Copilot or Codex chat's hooks do, through the built-in plugin of its launch (BTN-1346), and the hook route `/mail` answers for a project chat's session as for a chain's (`isChatSession`, `src/service/hosting.ts`). The letter is delivered and marked as in a task chat; one the hooks missed at the end of the turn goes on through `settleMail`, whose resume of a chat is `ProjectChats.resume`, a later message with the letter's prompt;
- with the session not mid-turn, a stop and a resume with the message; mid-turn the message is refused (`chats.busy`).

What differs from a task chat:

- neither the agent nor the inbox is tried for a hung session;
- files go into `.temp/inbox/` of the folder first (`chat.saveInbox`), and the prompt is `replyPrompt`, an answer to the session's open question included;
- a message while the first session still starts is refused (`chats.starting`).

### Its own packages

A chat may have packages of its own over the project's set (BTN-1696), a third level after Even Keel's default and the project's choice: `ChatRecord.packages`, a name and `true` or `false`; a name not there is as the level above has it.

- **The window.** The "More" window of "New session" (`ChatExtrasDialog`, logic in `web/src/pages/chatPackages.ts`) picks them per package — "As above", on, off — with what the chat gets and from which level. The built-in package has no switch. A chat's value of a package the project no longer has (out of the catalog, removed) is a row "removed from the catalog" with a reset, and the session never gets it.
- **Kept** like the account: chosen at creation, in `chats.packages` and in `chat_choices.packages` for the next window; `renew` keeps the old chat's.
- **Sent** with each `launch` and `send` (`ChatStart.packages`, absent when there are none). The machine builds the set with them on top (`enabledIn` with `own`, `Packages.chatStartOf`, `createChatSettings`), never turning the built-in package off. A change at the level above reaches a chat at its next restart; the chat's own value stays. A package's MCP parameters come by the gateway's route as for the chain (`docs/packages/gateway.md`).

## Its state for the page

`ProjectChats.list`/`card` give a `ChatCard` (`src/chats/model.ts`) with:

- the title (below);
- the agent, account, model and effort;
- the state, the context fill;
- the last message and whose it is (`user`, `agent`, `ask`), the time of the last event, whether the user has read it;
- archived, its successor.

**The title** is the user's name of the chat (`ChatRecord.name`, below), else the one the CLI wrote into the transcript (`custom-title`, `ai-title`, read by `MachineChats.title`; Claude only), until then the first message. A Claude `--bg` chat, started without a name, gets its `ai-title` from the CLI a few seconds after its first answer, and a rename in the CLI (`custom-title`) outranks it (BTN-1772). Under a launch name the CLI writes that name, the chat id, as the `custom-title` and generates no `ai-title`: for a chat launched so (an SDK one, one from before BTN-1772) a `custom-title` equal to its id is passed over, so only a rename replaces the first message (BTN-1339; a kept title equal to the id is dropped by `keptTitleOf`).

**A rename.** The user renames a chat in its window's head (BTN-1774): `ChatTitle` (`web/src/pages/ChatHead.tsx`) edits it in place with the built-in task title's behaviour (`usePlaceEdit`), and `chats/rename` keeps it in `chats.name` (step 88), active or archived. Even Keel writes nothing to the session (no `/rename`: invariant 1), and the sweep rewrites only `title`, so the name stays over every later `custom-title` or `ai-title`; an empty one sets it back to null and the automatic title returns. `renew` carries it into the new chat; the archive's search reads it. The window's **Chat** key (`ChatKey`) copies the session's id in place of the title, which a task session's window still does.

**The state** (`stateOf`): `new` (no message yet), `starting`, `working`, `waiting` (a question, a permission dialog, a startup dialog), `answered` (the turn ended and the cache is warm), `cold` (the cache window passed; without one, five minutes after the last event), `error` (a limit or an error that is not a temporary refusal), `archived`. The active list puts the waiting chats first, then by the last event, newest first. A chat is unread while its last message is the agent's and came after the user last opened it (`chats/read`).

**The calls** are `POST /api/chats/<name>` (`src/chats/routes.ts`):

- `list`: the project's active chats and its last choice;
- `archive`: a page of 20, newest first, `words` searched in the user's name, the title, the first and last message and what the user wrote; `more` says an older page follows, no total;
- `chat`: one chat, an archived one too;
- `machines`: the window's machines and `picked`, the one a chat without a machine goes to; each with its account panel — a machine elsewhere's from its mirror with the hub's limits, `null` for the own one, whose the page has live;
- `create` (an optional `machine`), `send` (text, answers and files in base64, up to 64 MB);
- `renew`: the same with the new chat's account, model and effort, and an optional `machine`; `continue`: the same choice without a message (below);
- `rename` (`name`; empty — back to the automatic title), `read`, `hide`, `delete` (an empty chat only, below).

**Sending.** Before the machine reports a session, a card with a user message under five minutes old shows `starting` (`BOOT_WAIT_MS`, `src/sessions/boot.ts`, the wait a session gets for its first prompt).

- The window moves the draft into the feed at once and keeps that bubble through the session id arriving, a missing transcript and an empty first read; the recorded prompt replaces it on the first read that contains it. The field stays editable during upload.
- Mid-turn the field is open where the page's mailbox of the session says it listens (`EvenKeelState.mailbox`, `SessionMail.listens`: it steers, its inbox is known or its hooks ask for mail), with the task chat's tip on Send (`t.session.chat.steers` or `mailbox`). Each mid-turn message appears at once as a user bubble; its clock changes to checks when the transcript contains it. A returned message shows a red mark with the reason, and its contents return to the draft. A session that cannot take a mid-turn message keeps the field shut until it stops.
- While the session's lamp is `working`, the task chat's turn line stands over the field — the clock's pill, then the action (`docs/web/session-panel.md`, BTN-1427): `ProjectChatWindow` gives the window the chat's session view.
- The saved draft also keeps attachments awaiting mailbox delivery. Reopening the chat shares its pending send. A failed send prepends the original text and files to the current draft and saves the reason even if the window has closed.

## Going on in a new session

A message to a chat whose cache went cold or whose account is at its limit may go to a new chat instead (BTN-1232).

- **When the page asks** (`chatRenewal` in `web/src/pages/chatRenewal.ts`): cold is the session's `coldReply` (without the session's view, the chat's state `cold`); a limit is the account's tightest window spent or the session's lamp `limit`, and it comes first. Not for a chat that works or starts, nor for one without a session.
- **What it offers:** the project's last choice; at a limit, when that is the same spent account, the next open account of the chat's agent, else of any agent (`renewalChoice`). The accounts, for the limit and for the offer, are those of the chat's machine (`useChatAccounts`): a machine elsewhere's are asked for through `machines` when the chat's window opens and again when the renewal window does.
- **The form.** Below the why and the quoted message the window has the form of "New session" itself (`ChatChoiceForm`, BTN-1711): the machine, offered first the chat's own, never the last choice's; the accounts by agent with their limits, the offered account's agent unfolded; the model and the effort.
- The model list of the "New session" and renewal windows is the hub's `models/list` by account key: a machine elsewhere's own catalogue is not read, so an account the hub has no folder of offers only the CLI's default.

`ProjectChats.renew` (`chats/renew`):

1. The files go into the folder's inbox and the text becomes `replyPrompt`, an open question's answers included, as for `send`.
2. The old chat's machine gives the old session's past (`MachineChats.past`: the monitor's `handoff` of the chat — its transcript path and recent feed lines); a failure leaves it out.
3. The old session is stopped (exception 12 in `docs/chain/exceptions.md`). A failed stop refuses the step and nothing changes. When the window named another machine and the old one is off the link, nothing is stopped there: a line in the log. Off the link is the link's liveness (`network.connected`), not the hub's mirror of it: a mirror outlives its machine's connection and its calls wait for the machine's return, so the chats' commands (`chatServicesOf`) give none for such a machine and the renewal does not wait for it (BTN-1739).
4. On another machine (`machine` in the call, checked by `placeOf` as for `create`) the old transcript is carried: the hub reads it from the old machine in parts of 4 MB (`MachineChats.transcriptPart`) and saves it into the new folder's `.temp/inbox/` as a message's files are (`saveInbox`). Over 64 MB, a failed read or save, a transcript the old machine no longer knows (a restarted machine forgets its chats' sessions; a line in the log), or the old machine off the link — no copy, and the prompt says the transcript stayed on that machine by its name.
5. The new chat is kept with `previous` (the old one) and `pending`, its whole first prompt (`renewPrompt`, `src/chats/prompt.ts`): a lead, the last 10 turns of the old chat taken from its feed without a model (the user's words and the agent's texts, each cut to 600 characters), the old transcript's path (on another machine its copy's) with "grep it, do not read it whole", then the message under `USER_MESSAGE_HEAD`, so the page shows it as the user's (BTN-1281). The old chat goes to the archive with the new one as its successor, and the new one becomes the project's last choice.
6. The new chat's session is launched with `pending`; once it is, `pending` is cleared. A failed launch clears it too and returns the error: the new chat stays, without a session, and the user's next message there starts it as any first message.

A restart between 5 and 6 loses nothing: the sweep finds an active chat with `pending` and no session and launches it with the same prompt, unless the machine already knows a session of the chat (`past`), which it then takes. An offline machine keeps it pending until the machine is back. A chat with `pending` and no session is `starting` for the page.

**Early, from the ⋯ menu** (BTN-1776). "Continue in new session…" of a chat with a session — on its card and in its window's head — moves it to another machine, account, model or effort before any cold cache or limit: `ProjectChats.continueEarly` (`chats/continue`: `id`, `account`, `model`, `effort`, an optional `machine`).

- **The window** is the renewal one without the why, the quoted message and "Reply here" (`ChatContinueDialog` over `ChatRenewDialog`). It offers first what the chat runs on, and its button stays greyed with why (`aria-disabled`) while the pick is that (`sameAsChat`: the hub's pick of a machine counts as the chat's own; a chat with no effort of its own counts as the effort the form shows).
- **At once** steps 2–4 of `renew` run — the old session is stopped mid-turn too, a transcript is carried while the old machine is on the link — and the old chat goes to the archive with the new one as its successor; the old card slides out as on Archive and an open window switches to the new chat.
- **The new chat launches nothing:** it keeps the hand-over (`ChatRecord.handover`, `chats.handover`, step 90; `handoverOf` — the lead, the last turns, the transcript's path, without a message) and stays `new` until the user's first message, which `send` sends under it (`withHandover`). Once the session is launched the hand-over is cleared; a failed launch keeps it for the next message.
- A chat without a session has no such item (`chats.noSession`); one starting or already moving is refused (`chats.starting`).

## An idle session

An idle chat's process group (the daemon, its pty host, the session, a `bg-spare`, its MCP servers) took about 510 MB on the server; the session stops long before the archive (BTN-1653, exception 11 in `docs/chain/exceptions.md`):

- **The cold cache.** The sweep stops the session of an active chat whose state is `cold` (`stateOf`: the cache window of `docs/sessions/cache.md` passed — 55 min for Claude on a subscription, 25 for Codex and Copilot) and whose process is up, unless it goes on in a new session right now (`moving`). The chat stays in the active list; its archive is a day later, as before.
- **The ceiling.** `chatSessions` (default 3, read at each launch) is how many chat sessions a machine keeps up. Before a chat's session comes up there — a first message, a message to a stopped session, a deferred relaunch — `makeRoom` stops that machine's chats over the ceiling (`roomFor`, `src/chats/model.ts`): the longest idle first, by the last event, never one `starting`, `working` or `waiting`. With all of them busy the new one starts anyway: the ceiling never holds a chat back.
- **Up or not** (`running`): a launch under way, or the machine's view of the session not `finished`. A session stopped as idle counts as stopped for two minutes (`STOP_SEEN_MS`), while the mirror may still show the view from before the stop.
- A failed stop is a line in the log (`was not stopped`); the sweep tries again a minute later, and a launch goes on.
- **The next message** takes the path of a stopped session in `MachineChats.send`: `--resume` with it, the same context, a few seconds of start. No threshold of the context: past the cache window a live process saves nothing.

## The archive

- A chat goes to the archive a day after its last message or its session's last action, **in any state** — mid-turn or waiting on a question too (`ARCHIVE_AFTER_MS`). The service's sweep runs once a minute (`CHATS_SWEEP_MS`): it also keeps the title, the last message and the time of the last event, so the archive has them once the session's view is gone.
- "Hide" (`hide`, Archive in the chat's ⋯ menu, BTN-1775) is the same archive at once, for a chat in any state; the transcript stays on disk. A first session still launching refuses it (`chats.starting`): the launch's end would keep the chat active again.
- On its way to the archive the session, if still up (an idle one stopped long before, above), is stopped through its agent (exception 11 in `docs/chain/exceptions.md`). A failed stop refuses "Hide"; the day-old sweep archives anyway and logs it.
- **An empty chat** — no session, none launching, nothing `pending`, no hand-over ("Untitled chat" right after "New session"): nothing of it runs and nothing is kept but its record, so its menu has Delete instead of Archive (`delete`, `ProjectChats.remove`): the row leaves the database for good. A chat with a session, one about to start, or one continued early and still waiting for its first message (it carries the old one's hand-over; its menu has Archive) is refused (`chats.hasSession`).
- An archived chat is only read: a message to it is refused (`chats.archived`); going on is a new chat. The chat a new session replaces goes to the archive with its successor (BTN-1232, exception 12).
- A restart loses nothing: the active chats are read back from the database, and their sessions are found again by the binding the hub hands back (a chat launched under its name by that name, as the chain's are). Only a Claude chat whose launch ended in a restart before its record took the session id is not found: its pending prompt is launched again, a second session (BTN-1772).

## The page

The Chats tab of the project page (BTN-1231) polls `list` every 4 s while the page is open, for its list and its badge; `archive` is asked per search and page, `create` from the "New session" window, `send` and `read` from the chat's window. A chat's window is the session's transcript window with the chat's field, without the commands menu; one without a session yet shows an empty feed. How it looks is in `docs/web/project-page.md` ("The Chats tab").

## In the stats

Tally reads each chat's session from the `chats` table and keeps it in `chat_sessions` (BTN-1233): such a session belongs to no task, even when its title names one, and `/stats` shows the chats' count and spend per project under the task table (`docs/tally.md` step 18, `docs/stats.md`).

## Not covered

Uncommitted changes a chat leaves in the main checkout hold up a chain task's merge the way a hand session's do from an editor: no guard of its own.
