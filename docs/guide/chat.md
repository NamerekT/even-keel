# Chat and questions

A session that needs you asks a question and waits. You answer from the page's chat, from a comment in the tracker or, for Claude sessions, through Remote Control. The chat also shows the session's whole transcript and takes messages while the session works.

- [The chat window](#the-chat-window)
- [Answering a question](#answering-a-question)
- [Writing while the session works](#writing-while-the-session-works)
- [Commands](#commands)
- [When something fails](#when-something-fails)
- [Keys](#keys)
- [Project chats](#project-chats)

## The chat window

The **Chat** button of the current session opens its whole transcript with a reply box. The button turns amber while the session waits for you; your answer resumes the session. The session's questions come one at a time as a card with radio buttons or checkboxes and free text.

The window's head names the task; point at its title for the session's id, press it to copy the id.

### Attaching files

Files you attach land in the task's `.temp/inbox/`, where the session reads them:

- **`+`** picks a file. On a phone it offers Camera, Photos and Files, and Paste for a picture in the clipboard, which a phone keyboard cannot paste into the field itself; the browser asks once to let the page read the clipboard.
- **Ctrl+V** pastes a file or a screenshot straight from the clipboard.
- **Dropping** a file on the window attaches it.

Before you send, a picture or a video waiting above the box opens full-window with a click. A screenshot in the clipboard panel of a phone keyboard (Gboard) is not in the system clipboard, so Paste finds no picture there: copy it explicitly (Gallery → Share → Copy) or attach it through Photos.

An unsent reply — its text and files — stays with each session's chat in your browser: close the window or reload the page and it is still there, until you send it.

### Dictation

The microphone beside the send button types what you say into the reply box.

- **The browser's recognition**, by default: in the page's language, as you speak. Press it again to stop; on a phone it stops by itself at a pause. Your voice goes to the browser maker's service (Google for Chrome, Microsoft for Edge, Apple for Safari). It shows in Chrome, Edge and Safari on a page opened over HTTPS or on `localhost`. Firefox has no such recognition, and a browser gives no microphone to a page over plain HTTP, so there the button is not shown: use the keyboard's own microphone (Win+H on Windows, dictation on macOS).
- **A model through LiteLLM**, once Settings → **Stats** → **Span classifier** has its **Address** and **Key**. The microphone then records, and the model hears the language itself: speak Russian, German or English, or switch between them in one phrase. This works in Firefox too.
  - Press to record — the button shows the time — and press again to stop; the text comes a second or two after the stop, and the button spins until then. A recording stops by itself at two minutes.
  - The sound goes through Even Keel to your LiteLLM and from there to the model's provider (Google for Gemini); the key stays in Even Keel.
  - The model is the **Dictation model** of the same section, by default `google-gemini-3.5-flash-lite`, not the classifier's, so a day of dictation does not eat the classifier's free quota. Each recording is one request; its tokens are counted on `/stats` under the account `litellm`.
  - When the free quota is used up, the microphone falls back to the browser's recognition for an hour (for a few minutes after another failure), and its tip says why the last recording was not transcribed.

### What the feed shows

- **Pictures** the session read and the ones you sent show as thumbnails that open full-window, with a pager through all of them; a folded run of calls shows its pictures as one stack that opens on the first. A picture you send shows in your message at once, even while the session is still starting; one sent from another window or device shows its filename while it loads and can be clicked to open the viewer.
- **Videos** you send show as their first frame with ▶ and play in the same viewer. The session never reads a video, so once its task is done and its folder is cleaned up, a video sent from another device is only its filename.
- **Files the session sends you** (Claude Code's `SendUserFile`) stand in a block of their own: a markdown file rendered in place, a picture as a thumbnail, anything else to download — as long as the file is still in the session's folder or its project's folder.
- **Your messages** show at once, with a delivery icon left of the time ([Writing while the session works](#writing-while-the-session-works)); point at the icon for its words and the time of delivery.
- **The session's last message** has a menu on a right click, or a long press on a phone: **Copy text**, and **Accept as answer** where the task can be closed with it.

### The line under the box

The line under the reply box says what the session is at: its branch and edits on the left; its account, the model of its last answer and a ring of how full its context is on the right. Press the ring for the token counts, the mark where the session will hand over to a fresh one, and the account's limits. A finished session's transcript keeps the same line at its bottom.

Anything else the chat has to tell you — a message it could not send, a question the session has not saved yet, an answer to accept — comes as a banner over the reply box, with its button and a ✕ that closes it.

### The task beside the chat

The sidebar button at the left of the head, the task key beside it, or Ctrl+B (Cmd+B on a Mac) opens the task beside the chat: its status, description, attachments and comments, read only, kept up to date as the task changes. **Open the card** at its bottom closes the chat and opens the full card, where you edit the task and comment.

The chat remembers whether the panel was open. On a narrow window the panel lies over the feed; on a phone the button opens the full card instead, and closing it brings the same chat back, your unsent reply still in the box.

## Answering a question

A question comes to the chat as a card with its options. The same question can be answered in other places, and two kinds of question need a word of their own.

### From the tracker

A question with options is also posted to the tracker as a numbered comment; reply with `2`, `1, 3` or text, in a comment of the task or in the question's thread where the tracker has threads (Huly, Linear, GitLab).

The reply reaches the session 15–30 seconds later, once two checks of the tracker in a row see it unchanged, so files attached to it and a second comment written right after go along.

Remote Control still works for Claude sessions: the page links each one's Remote Control ([setup](remote.md#answering-from-the-phone)).

### A permission dialog

A Claude session can stop on a permission dialog: a command an `ask` rule in your settings holds, or a call its automatic permission check keeps refusing. Even Keel puts the call to you:

- **In a chat**, a task's or a project's, it stands over the field as a card: "The session wants to run Bash", the command under it, and **Allow** and **Deny**. Words you typed in the field go with the press: after Allow as your next message, with Deny as the reason.
- **The question panel and the tracker comment** show it as a question, "Allow the session to run Bash?", with the command beside "Allow", and "Deny".

The card and the question say "(several commands)" when the command has more than one line or joins commands with `&&`, `||`, `;` or `|`. The agent's own description of the call comes after the command, marked "The agent says", since it is the agent's word, not a check. A very long call keeps its first 12,000 and last 4,000 characters and says how many are hidden between them.

Answer it from any of these places, and the session goes on at once, without a stop: the call runs, or the session gets your refusal and your words. A session on another machine is answered the same way. When Claude Code gives up on the dialog by itself, the card goes and the chat says the call was refused. While the chain runs unattended such a call is refused at once.

Codex and OpenCode sessions never stop on such a dialog.

### After a long wait

If the session has waited for you past its prompt cache (the ring on its row is empty), a reply to it rereads its whole context at full price. **Send** then first asks how to go on:

- **New session with this message**, the suggested choice: a new session in the same worktree gets the usual handoff note and your words, answers and files. Until it is up, the chat shows your message with the stage of the handover; the box opens again with the new session's feed. If the handover fails, the error shows under the old feed and your text goes back into the box. The old session stays readable in the task's session list.
- **Reply to this session** sends it as before.
- **Cancel** keeps the text in the box.

A session whose chain has stopped offers only the reply.

## Writing while the session works

You can write to a session while it works: it takes your message at its next tool call or at the end of its turn. Your message appears at once with a clock with turning hands, which changes to two green checks once the session has it. A message sent from another window also shows a clock while it waits.

If the turn ends before the session takes your message, Even Keel resumes the same session with it, also when the chain stops after that turn. A restart of Even Keel does not close the box of a session it started: you can write to it at once, even while it sits in one long command, and the message waits for the command to end.

If the session asks a question, stops, or the task closes before delivery, the message comes back:

- the bubble shows a red mark until you send the next message; point at it for the reason;
- the message and its attachments return to the box ahead of whatever you have typed, even if you closed the chat; on another device, the draft includes the saved file paths;
- a closed task keeps the draft available to copy.

## Commands

Type `/` at the start of a message, or press the `/` button beside `+` in an empty box, for the chat's commands: a menu above the box lists them, filtered as you type, with ↑/↓ to move, Tab or Enter to pick and Esc to close. A command only counts from the chat: the same text in a tracker comment reaches the session as written.

**`/handoff`** asks the session to hand the task over to a fresh one: it writes its handoff note, and Even Keel starts the next session on the note, as on a full context. Words after the command (`/handoff option 1 is the one; keep the tests`) go into the request for the note. It works in every state of the session — idle, mid-turn or answering its question — and the chat shows the message as you typed it.

**In a Claude session** the menu also lists, each under its own heading:

- your own commands and skills from `~/.claude-config` ([your Claude Code configuration](hub-machine.md#your-claude-code-configuration-on-every-machine)) as the hub has them;
- the skills and commands of the project's [packages](packages.md), named `/plugin:skill`.

A row shows the description its file gives. A skill hidden from Claude Code's own `/` menu is hidden here too, and a task's session leaves out the skills [Trim the tools](config-sessions.md) takes away from it. The menu is read again each time it opens, so a changed configuration or package shows without a restart. Even Keel's own commands win over a skill of the same name. Such a command or skill goes to the session as you typed it, `/name` and its words, and Claude Code runs it.

**In a Codex session** a skill is called as `$name`, so its menu lists your skills and the packages' skills (`$plugin:skill`; Codex has no commands) and puts the one you pick in as `$name`; typing `$` at the start of a message opens the same list. **Trim the tools** does not reach Codex, so nothing is left out for it.

Other agents call skills their own way, so their menu has only Even Keel's commands.

## When something fails

- **A turn stopped on an API error:** send a reply from the chat to resume the session. While the agent is still working or retrying the request, your message waits as during any turn.
- **OpenCode silent for 30 seconds:** Even Keel looks for a stream error of that session in its account's log. A usage limit then waits for its reset as usual; another stream error shows its message and lets you send a reply or choose **New session**.
- **A reply that cannot be delivered:** Even Keel says so and leaves the chain running; the message comes back as [a message that missed its session](#writing-while-the-session-works) does, and you can retry once the cause is resolved.

## Keys

- On a computer, Enter sends a reply and Shift+Enter starts a new line; Ctrl+Enter and Cmd+Enter also send. Enter that confirms IME input does not send.
- In a question's "Other" field, Enter goes to the next question or submits the last one, while Shift+Enter starts a new line. Selecting an option never advances by itself.
- On a phone or tablet, Enter starts a new line: use the buttons to send or go to the next question.

When a reply cannot go yet, the empty box and the tip of the send button say why. The box grows to five lines and then scrolls.

## Project chats

Besides the sessions of tasks, a project has chats of its own: a session without a task, to talk about the project, ask a question about its code or plan the next tasks. A chat runs in the project's main folder on the machine that has it.

- **Packages.** A chat gets the project's [packages](packages.md), the same plugins and MCP servers a chain session gets, always in their current versions; the account's own plugins and MCP servers and the folder's `.mcp.json` stay out, as in the chain. A chat already running takes a changed set the next time its session restarts, keeping its history.
- **Unlike a task's session**, a chat keeps all its skills (**Trim the tools** does not apply) and has no handoff note.

Sessions you start yourself in a terminal or VS Code keep their own settings.

The chats are the **Chats** tab of the project page, between Backlog and Settings (Settings is the gear icon there). Its badge is amber with the number of chats waiting for you — a question or a permission — and blue with the number of answers you have not opened yet. On a phone the tabs take the first row under the project's name, and the tab opens over the whole screen.

- **Active** lists the chats, those waiting for you first, then by their last event. A card shows the agent's icon in the chat's colour (blue — working, amber — waiting for you, green — answered, grey — the cache went cold, red — a limit or an error), the title, the machine when the project has more than one, the account, the model and effort, how full the context is and the last message.
- **Archive** lists the older chats, with a search over titles and messages, twenty to a page.

### Starting a chat

**New session** opens a window where you choose, top to bottom:

1. **The machine**, when the project has several: the machines of the project's pool, or every machine with a folder of the project when the pool is empty. The machine of your last chat in the project is picked already while it can take one; a machine off the link or without a folder of the project stays in the list, unavailable, with its reason. The machine stays at the top while the accounts scroll.
2. **The account**: the accounts signed in on that machine, by agent, with their 5-hour and weekly limits, named as on the accounts page. Each agent's head folds its accounts; the window opens with only the agent of the account offered first unfolded, and a folded agent names the account picked in it. The account the project's chain runs on is tagged "chain", and one at its limit cannot be picked until its reset.
3. **The model and the effort.**
4. **More**, at the bottom, opens the chat's packages: each one "As above" — as Even Keel and the project have it, so a change there reaches the chat — or on or off for this chat only. Under each name is what the chat gets and where that comes from. Even Keel's built-in package is always on. A package you turned on for chats that has since left the catalog stays as "removed from the catalog", with **Reset**: the chat does not get it. The number on **More** counts the packages you set for the chat.

**Start chat** opens an empty chat: the session starts with your first message. The choices stay until the chat ends, and Even Keel offers your last choice in that project for the next chat.

### In a chat

- A chat opens in the same window as a task's session. Press its title in the head to rename it: Enter or a click elsewhere saves, Esc cancels, and an empty name brings back the automatic one. Your name stays over the title the agent gives the chat, shows on its card and in the archive, is found by the archive's search and goes on with the chat into a new session; the session itself is not told.
- Its `/` menu has no `/handoff`: a Claude chat lists your commands and skills and the project's package ones, other agents' chats have no menu.
- Your first message appears as soon as you send it and stays visible while the session starts. You can type and attach files for your next message while the previous one uploads; if the upload fails, the chat shows the reason and puts the text and attachments back before your new draft.
- While the chat works, you can write to it if its session takes messages mid-turn, with the same clock, checks or failure mark as a task chat ([Writing while the session works](#writing-while-the-session-works)). Otherwise the field tells you when you can send.
- A restart of Even Keel keeps every chat and finds its session again.
- On the stats page a chat's spend counts for no task: the project's chats and their spend stand on a line of their own under the task table.

### Archiving and going on

- A chat goes to the archive a day after its last message or its session's last action, whatever it is doing then, and its session is stopped. Hiding a chat archives it too; nothing is deleted, and the transcript stays on disk. An archived chat is only for reading: to go on, start a new chat.
- A message to a chat whose cache went cold asks first: reply there anyway, which rereads the whole context, or **New session with this message**. When the chat's account is at its limit, only the new session is offered, with the next account with room picked already. The window shows your message and lets you pick the account, the model and the effort; the new session stays on the chat's machine. It gets your message, the last turns of the old chat and a link to its transcript; the old chat goes to the archive, its session stops, and the new chat opens with a "Continued from" link to it. **Cancel** keeps your text and files in the field.
- To move a chat to another machine, account, model or effort sooner, pick **Continue in new session…** in its ⋯ menu, on the card or in the chat's head. The same window opens without a message; **Continue** stays greyed until you change something. The old chat goes to the archive at once; the new chat opens in its place, and its session starts with your first message, which takes along the last turns of the old chat and a link to its transcript.
