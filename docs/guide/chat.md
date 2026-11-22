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

The **Chat** button of the current session opens its whole transcript with a reply box: the session's questions one at a time as a card with radio buttons or checkboxes, free text and files — picked with `+` (on a phone it offers Camera, Photos and Files, and Paste for a picture in the clipboard, which a phone keyboard cannot paste into the field itself; the browser asks once to let the page read the clipboard), pasted with Ctrl+V (a screenshot straight from the clipboard) or dropped on the window — which land in the task's `.temp/inbox/`. Before you send, a picture or a video waiting above the box opens full-window with a click.

A fresh screenshot shown in the clipboard panel of a phone keyboard (Gboard) is not in the system clipboard, so Paste finds no picture there: copy the screenshot explicitly (Gallery → Share → Copy) or attach it through Photos.

The microphone beside the send button types what you say into the reply box, in the page's language, as you speak. Press it again to stop; on a phone it stops by itself at a pause. It is the browser's own speech recognition, so your voice goes to the browser maker's service (Google for Chrome, Microsoft for Edge, Apple for Safari). It shows in Chrome, Edge and Safari on a page opened over HTTPS or on `localhost`; Firefox has no such recognition, and a browser gives no microphone to a page over plain HTTP, so there the button is not shown — use the keyboard's own microphone (Win+H on Windows, dictation on macOS).

With the LiteLLM connection of the stats classifier set (Settings → Stats: Address and Key), the microphone records instead and a model hears the language itself: speak Russian, German or English, or switch between them in one phrase, with no language to choose. Press it to record — the button shows the time — and press again to stop; the text comes into the reply box a second or two after the stop, not word by word, and the button spins until then. A recording stops by itself at two minutes. The sound goes through Even Keel to your LiteLLM and from there to the model's provider (Google for Gemini); the key stays in Even Keel. The model is the Dictation model of the same settings, by default `google-gemini-3.5-flash-lite`, not the classifier's, so a day of dictation does not eat the classifier's free quota; each recording is one request, and its tokens are counted on `/stats` under the account `litellm`. When the free quota is used up, the microphone falls back to the browser's recognition for an hour (for a few minutes after another failure), and its tip says why the last recording was not transcribed. This also works in Firefox, which has no recognition of its own but can record.

Pictures the session read and the ones you sent show as thumbnails that open full-window, with a pager through all of them; a folded run of calls shows its pictures as one stack that opens on the first.

A picture you send shows in your message at once, from the file you picked, even while the session is still starting. A picture sent earlier, from another window or device, shows its filename while it loads; you can click it to open the viewer, and the chat retries the picture automatically.

Files the session sends you (Claude Code's `SendUserFile`) stand in the chat as a block of their own: a markdown file rendered in place, a picture as a thumbnail, anything else to download — as long as the file is still in the session's folder or its project's folder.

The button turns amber while the session waits for you. Even Keel stops the session and resumes it with your answer.

An unsent reply — its text and files — stays with each session's chat in your browser: close the window or reload the page and it is still there, until you send it.

A sent message shows at once, with an icon left of its time: a clock with turning hands while it is on its way to the session (the loading bar at the top of the page stays still for it), two green checks once the session has it, a red sign if it could not be delivered. Point at the icon for its words and the time of delivery.

The window's head names the task; point at its title for the session's id, press it to copy the id.

The line under the reply box says what the session is at: its branch and edits on the left, its account, the model of its last answer and a ring of how full its context is on the right. Anything else the chat has to tell you — a message it could not send, a question the session has not saved yet, an answer to accept — comes as a banner over the reply box, with its button and a ✕ that closes it.

Right click the session's last message, or press and hold it on a phone, for its menu: "Copy text", and "Accept as answer" where the task can be closed with it.

Press the ring for the figures, the mark where the session hands over to a fresh one, and the account's limits.

A finished session's transcript keeps the same line at its bottom.

### The task beside the chat

The sidebar button at the left of the head, the task key beside it, or Ctrl+B (Cmd+B on a Mac) opens the task beside the chat: its status, description, attachments and comments, read only, kept up to date as the task changes.

**Open the card** at its bottom closes the chat and opens the full card, where you edit the task and comment.

The chat remembers whether the panel was open.

On a narrow window the panel lies over the feed; on a phone the button opens the full card instead, and closing it brings the same chat back, your unsent reply still in the box.

## Answering a question

A question comes to the chat as a card with its options. The same question can be answered in other places, and two kinds of question need a word of their own.

### From the tracker

A question with options is also posted to the tracker as a numbered comment; reply with `2`, `1, 3` or text, in a comment of the task or in the question's thread where the tracker has threads (Huly, Linear, GitLab).

The reply reaches the session 15–30 seconds later, once two checks of the tracker in a row see it unchanged, so files attached to it and a second comment written right after go along.

Remote Control still works for Claude sessions: the page links each one's Remote Control ([setup](setup.md#answering-from-the-phone)).

### A permission dialog

A Claude session that stops on a permission dialog — a command an `ask` rule in your settings holds, a call the `auto` classifier keeps refusing — puts the call to you as a question: "Allow the session to run Bash?" with the command beside "Allow", and "Deny".

The question says "(several commands)" when the command has more than one line or joins commands with `&&`, `||`, `;` or `|`.

The agent's own description of the call comes after the command, marked "The agent says", since it is the agent's word, not a check.

A very long call keeps its first 12,000 and last 4,000 characters and says how many are hidden between them; the tracker comment shows the call the same way.

Answer it from the chat, the question panel or the tracker comment, and the session goes on at once, without a stop: the call runs, or the session gets your refusal and your words.

While the chain runs unattended such a call is refused at once.

On a session on `--bg` the built-in [agent-bridge](../../plugins/agent-bridge) plugin's hook holds the dialog; one on the Agent SDK transport needs no hook; while the plugin is not installed yet, the dialog is answered through Remote Control.

Codex and OpenCode sessions never stop on such a dialog.

### After a long wait

If the session has waited for you past its prompt cache (the ring on its row is empty), **Send** first asks how to go on: a reply to that session rereads its whole context at full price, so the suggested choice is **New session with this message** — a new session in the same worktree gets the usual handoff and your words, answers and files. Until the new session is up, the chat shows your message with a ship and the stage of the handover; the box opens again with the new session's feed, where your message stands on its own. If the handover fails, the error shows under the old feed and your text goes back into the box. The old session stays readable in the task's session list.

**Reply to this session** sends it as before; **Cancel** keeps the text in the box.

A session whose chain has stopped offers only the reply.

## Writing while the session works

You can write to a session while it works. Its hooks can pass the message at the next tool call or at the end of the turn. Claude Code can also receive it through its inbox. Your message appears immediately with a clock. The clock changes to two green checks on the same bubble once the transcript contains the message. A message sent from another window also shows a clock while it waits in the session’s queue.

If the session asks a question, stops, or the task closes before delivery, the bubble shows a red mark. Point to it for the reason. The message and its attachments return ahead of whatever you have typed. On another device, the draft includes the saved file paths. A closed task keeps its draft available to copy.

If the hook times out before the service sends its response, the message stays queued for the next hook or resume.

A Claude session on the Agent SDK transport needs no plugin for it: the message goes straight in and the session reads it once its current tool call ends.

If the turn ends before the hook takes your message, Even Keel resumes the same session with it, including when the chain stops after that turn.

A restart of Even Keel does not shut the box of a session it started: you can write to it at once, even while it sits in one long command. That message waits for the command to end; from the session's next tool call Claude Code takes your messages straight through its inbox again.

The message stays waiting until the resume succeeds; if it fails or another session takes over, the message comes back to the chat.

## Commands

Type `/` at the start of a message, or press the `/` button beside `+` in an empty box, for the chat's commands: a menu above the box lists them, filtered as you type, with ↑/↓ to move, Tab or Enter to pick and Esc to close.

**`/handoff`** asks the session to hand the task over to a fresh one: it writes its handoff note and ends with the `CHECKPOINT:` mark, and Even Keel starts the next session on the note, as on a full context.

Words after the command (`/handoff option 1 is the one; keep the tests`) go into the request for the note.

It works the same in every state of the session — idle, mid-turn or answering its question — and the chat shows the message as you typed it.

A command only counts from the chat: the same text in a tracker comment reaches the session as written.

## When something fails

If a turn stops on an API error, send a reply from the chat to resume the session. While the agent is still working or retrying the request, the usual rules for messages during a turn apply.

If OpenCode stays silent for 30 seconds, Even Keel also checks its account log for a stream error from that session.

A usage limit then follows the usual limit wait; another stream error shows a translated message and lets you send a reply or choose **New session**. Without such an error, the existing hang check still applies.

If your reply cannot be delivered, Even Keel reports the failure and leaves the chain running; the message stays in the chat marked red until you send the next one. The field clears as soon as you send. If the reply fails, its text and files return ahead of any new draft, even if you closed the chat. You can retry once the cause is resolved.

## Keys

On a computer, Enter sends a reply and Shift+Enter starts a new line; Ctrl+Enter and Cmd+Enter also send.

In a question's "Other" field, Enter goes to the next question or submits the last one, while Shift+Enter starts a new line.

Selecting an option never advances by itself. Enter that confirms IME input does not send.

On a phone or tablet, Enter starts a new line: use the buttons to send or go to the next question.

When a reply cannot go yet, the empty box and the tip of the send button say why. The box grows to five lines and then scrolls. On a phone it stops at four, and while you type the line under the box steps aside to leave the feed more room; a draft you leave folds to its first line until you tap it.

## Project chats

Besides the sessions of tasks, a project has chats of its own: a session without a task, to talk about the project, ask a question about its code or plan the next tasks. A chat runs in the project's main folder on the machine that has it, with everything a session you start there by hand has: the folder's settings and MCP servers and the account's plugins. Nothing of the chain's set applies to it.

The chats are the **Chats** tab of the project page, between Backlog and Settings (Settings is the gear icon there). Its badge is amber with the number of chats waiting for you — a question or a permission — and blue with the number of answers you have not opened yet. On a phone the tabs take the first row under the project's name, and the tab opens over the whole screen.

- **Active** lists the chats, those waiting for you first, then by their last event. A card shows the agent's icon in the chat's colour (blue — working, amber — waiting for you, green — answered, grey — the cache went cold, red — a limit or an error), the title, the account, the model and effort, how full the context is and the last message.
- **Archive** lists the older chats, with a search over titles and messages, twenty to a page.
- **New session** opens a window with the accounts by agent and their 5-hour and weekly limits; the account the project's chain runs on is tagged "chain", and one at its limit cannot be picked until its reset. Below are the model and the effort. **Start chat** opens an empty chat: the session starts with your first message.
- A chat opens in the same window as a task's session, without the commands menu.

- You choose the account, the model and the effort when you create a chat, and they stay until the chat ends. Even Keel offers your last choice in that project for the next chat.
- Your first message appears in the chat as soon as you send it and stays visible while the session starts. You can type and attach files for your next message while the previous one uploads. If the upload fails, the chat shows the reason and puts the original text and attachments before your new draft, even if you closed the chat.
- You can also send a message while a project chat is working if its session accepts mid-turn messages. The bubble shows the same clock, checks or failure mark as a task chat. Otherwise the field tells you when you can send.
- A chat goes to the archive a day after its last message or its session's last action, whatever it is doing then, and its session is stopped. Hiding a chat archives it too; nothing is deleted, and the transcript stays on disk.
- An archived chat is only for reading. To go on, start a new chat.
- A message to a chat whose cache went cold asks first: reply there anyway, which rereads the whole context, or **New session with this message**. When the chat's account is at its limit, only the new session is offered. The window says why, shows your message and lets you pick the account, the model and the effort; at a limit the next account with room is picked already. The new session gets your message, the last turns of the old chat and a link to its transcript; the old chat goes to the archive, its session stops, and the new chat opens with a "Continued from" link to it. Cancel keeps your text and files in the field.
- A restart of Even Keel keeps every chat and finds its session again.
- On the stats page a chat's spend counts for no task: the project's chats and their spend stand on a line of their own under the task table.

How chats are built is in [Project chats](../sessions/project-chats.md).
