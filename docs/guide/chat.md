# Chat and questions

A session that needs you asks a question and waits. You answer from the page's chat, from a comment in the tracker or, for Claude sessions, through Remote Control. The chat also shows the session's whole transcript and takes messages while the session works.

- [The chat window](#the-chat-window)
- [Answering a question](#answering-a-question)
- [Writing while the session works](#writing-while-the-session-works)
- [Commands](#commands)
- [When something fails](#when-something-fails)
- [Keys](#keys)

## The chat window

The **Chat** button of the current session opens its whole transcript with a reply box: the session's questions one at a time as a card with radio buttons or checkboxes, free text and files — picked with `+`, pasted with Ctrl+V (a screenshot straight from the clipboard) or dropped on the window — which land in the task's `.temp/inbox/`.

Pictures the session read and the ones you sent show as thumbnails that open full-window, with a pager through all of them; a folded run of calls shows its pictures as one stack that opens on the first.

Files the session sends you (Claude Code's `SendUserFile`) stand in the chat as a block of their own: a markdown file rendered in place, a picture as a thumbnail, anything else to download — as long as the file is still in the session's folder or its project's folder.

The button turns amber while the session waits for you. Even Keel stops the session and resumes it with your answer.

An unsent reply — its text and files — stays with each session's chat in your browser: close the window or reload the page and it is still there, until you send it.

The window's head names the task; point at its title for the session's id, press it to copy the id.

The line under the reply box says what the session is at: its branch and edits on the left, its account, the model of its last answer and a ring of how full its context is on the right.

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

If the session has waited for you past its prompt cache (the ring on its row is empty), **Send** first asks how to go on: a reply to that session rereads its whole context at full price, so the suggested choice is **New session with this message** — a new session in the same worktree gets the usual handoff and your words, answers and files.

**Reply to this session** sends it as before; **Cancel** keeps the text in the box.

A session whose chain has stopped offers only the reply.

## Writing while the session works

You can also write to a session while it works ("not there", "mind X too"): a hook of the [agent-bridge](../../plugins/agent-bridge) plugin hands the message over at its next tool call or at the end of the turn, without stopping it, and the chat shows whether it waits, was delivered, or came back because the session asked a question meanwhile.

Once the task's branch is merged or the task is done, the session gets no more messages: the chat refuses them, and one already on its way comes back, since the work it asks for belongs in a new task.

If the hook times out before the service sends its response, the message stays queued for the next hook or resume.

A Claude session on the Agent SDK transport needs no plugin for it: the message goes straight in and the session reads it once its current tool call ends.

If the turn ends before the hook takes your message, Even Keel resumes the same session with it, including when the chain stops after that turn.

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

If your reply cannot be delivered, Even Keel reports the failure and leaves the chain running. Send the reply again when the cause is resolved; Even Keel does not automatically retry a failed delivery.

## Keys

On a computer, Enter sends a reply and Shift+Enter starts a new line; Ctrl+Enter and Cmd+Enter also send.

In a question's "Other" field, Enter goes to the next question or submits the last one, while Shift+Enter starts a new line.

Selecting an option never advances by itself. Enter that confirms IME input does not send.

On a phone or tablet, Enter starts a new line: use the buttons to send or go to the next question.
