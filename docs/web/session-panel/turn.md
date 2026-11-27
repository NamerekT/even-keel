# The chat: the turn line, delivery and the feed

The line of what the session does now, how a sent message is delivered and marked, mail to a working session, the message menu, how the feed follows its end and how a live transcript window reads. The field itself is in `composer.md`.

## The turn line

BTN-183: while the session's lamp is `working`, a line under the feed shows the time since the turn began (`formatElapsed`, ticking every second on the page) and what the session does — "Running: " and the running call's tool line, or "Thinking"; a turn that ended while its background command runs waits for that command instead (BTN-960).

- **From the window's own reads** (`Feed.turn` of `GET /api/sessions/<id>/transcript`), not the state, so a call starting or ending broadcasts no state. A Claude turn begins at the last prompt that is not a meta line (task notifications too), and a call is running from its `tool_use` until its `tool_result`.
- **No token count**: the transcript writes an answer's `output_tokens` only once the answer is done, so a count would stand still while the model thinks and then jump.
- **Mostly "Thinking".** A `Read` or a `grep` returns in milliseconds, and the seconds between calls are the model generating. A Codex turn begins at `task_started`, and the rollout writes a call only once it has finished, so Codex always shows "Thinking".
- **The row** (`TurnRow`, BTN-1427): the elapsed time is a grey `.count-badge` pill right after the lamp, before the action, of a fixed width (`.transcript__turn-time`), so the action's text starts at one place, never moves on a tick, and a long one is cut with an ellipsis while the pill stays whole; the pill's tip says when the turn began ("The turn has been going since 16:05").
- **Whose turn** (`turnSession`): a task chat's session (`ChatTarget.session`) or, in a window without one, its own `session` prop — a project chat's (`ProjectChatWindow`), whose window draws its field through `foot`. None during a handover: the loader takes the line's place, its phase and time side by side.
- **dev:fake**: ABC-5 runs a shell command, the rest think (`?parallel=2`, the chat of DEMO).

### The delivery phase

BTN-188. An answer stops the session and resumes it with the answer (7–10 s), and the transcript still ends in the turn before. `turnPhase` (`web/src/pages/turnPhase.ts`), one pure function, makes the phase from what the window knows, and its `delivering` phase does two things: it keeps the old turn's tool off the line — from the send until the answer lands the line draws nothing, and the clock of the message's delivery mark tells it (BTN-1362) — and it fixes where the next turn's clock starts.

- **What the window knows**: the last reply sent from this window (browser clock), the chain's delivery in progress (`ChainBlock.answering`, the `starting` of a `CurrentTask` that is `answering`) and the journal's last answer to the session (`TaskSession.answeredAt`, also written for a session answered after its chain stopped, `deliverLoose`, and for a tracker comment's answer).
- **Landed** once the transcript has a turn begun at or after the answer, or a prompt or an answer line written after it, or three minutes passed (the hold of `ResumeHolds`); while the chain still delivers it, it has not.
- **The clock** runs from the send, and the turn the answer began goes on counting from it — "Thinking" with the same count, no jump back when the prompt lands; a turn begun more than three minutes after the answer counts from its own prompt.
- **Codex** is the same: its answer is a new `codex exec resume`, the new turn begins at its `task_started`.
- **dev:fake**: an answer from the chat stays in the delivery phase for three minutes, since the fake transcript gets no new prompt.

## The delivery mark

`DeliveryMark` in `web/src/pages/DeliveryMark.tsx`, `sentFeed` in `web/src/pages/sentLines.ts`, in the task's chat and the project chat alike. Under every user bubble, left of its time, an icon:

- **a muted clock** while a sent or queued message is awaiting its transcript line ("Delivering"; its hands turn, and stand with reduced motion). The send itself — `deliver` of `useLive`, `web/src/live/actions.ts` — stays off the top bar, which a delivery of minutes would leave running (BTN-1393);
- **two green checks** once the transcript holds it ("Delivered at HH:MM", the transcript line's time; every user line of the transcript shows them);
- **a red sign** when the server refused it ("Not delivered").

The words are the icon's tip (`Tipped`), never a `title`.

- **A refused line** stays in the feed without its answer card, while its text and files go back into the draft; it counts as no answer to its question, and the next send takes it out.
- **One React key.** A sent line and the transcript line that lands for it share one key (`sent-<id>`, one matching transcript reply per send), so the bubble is the same element through the landing however many lines arrive before it: no blink, no jump of the scroll, only the icon changes.

## Mail to a working session

BTN-1490. The send button stays available while the session listens, with its hook or steering tip, and each send echoes into the feed at once.

- **Shared marks.** Mailbox rows and CLI queue entries seen in this window carry the same delivery marks, messages from Remote Control included. The clock turns to checks when the matching user line appears in the transcript, after an inbox delivery or a resume too. The bubble and its pictures keep their keys throughout.
- **After the first read.** They join the feed only after the window's first read of the transcript: until then a window with a session shows the loader, a reopened project chat's first message included, and does not look starting (BTN-1698, `shownLines` in `web/src/pages/sentLines.ts`); only a message sent from this window, or one with no session to read yet, shows before the read.
- **A returned message** shows the red mark with the reason (question, stopped session or closed task). Its text and locally submitted attachments go back ahead of the current draft once: the draft keeps the original files while mail waits and records which returns it has restored. A browser that lacks the original files puts their session paths in the draft.

## The menu of the agent's last message

BTN-1363, `MessageMenu` in `web/src/pages/MessageMenu.tsx`, the look of `MoreMenu`'s list.

- **Opening.** The last text line of the feed opens it on a right click, and on a long press of a finger (500 ms, cancelled by a move of 10 px; Android's own `contextmenu` and the timer for Safari open it once).
- **Items**: "Accept as answer" while `ChatTarget.accepts` (it goes through the composer's handle, so a refusal is the same banner) and "Copy text" where the page has a clipboard.
- **Closing**: Escape, Tab, a press elsewhere, a scroll and a resize. Text selected in the message keeps the browser's menu, and so does a message with no item.

## Following the feed's end

The chat and the Activity feed follow their end through `useFeedPin` (BTN-1372). A resize observer keeps a pinned chat at its end through new messages, composer changes and image loads. A wheel, touch, scrollbar or keyboard scroll lets the reader move away. A folded message that was never opened does not scroll its toggle into view as it mounts.

## How a live transcript window reads

- **When.** The window reads its session's transcript when the service says the file changed, and every 5 s besides in case a word was missed. Each read folds the whole file again.
- **The watch.** Reading registers the file with `TranscriptWatch` (`src/sessions/watch.ts`, the file from the optional `Agent.feedFile`): an `fs.watch` on it, whose events settle for 100 ms into one SSE `transcript` event `{sessionId}` (`EventHub.signal`: `broadcast` drops a frame equal to the last one, and this one always is). A file nobody read for 30 s is dropped, and a watcher that fails is dropped and logged while the poll goes on. Seen live on Windows ([verified](../../verified/page.md)).
- **The cards and the chain** keep `SESSION_POLL_MS` (3 s), since each tick starts `claude agents` once per account folder (~260 ms each).

## `POST /api/session/answer`

It takes `{project, task, sessionId, ask, answers, text, files: [{name, data}]}`: `ask` is the open question's `tool_use` id or `null` for a plain-text question, `answers` maps the question text to the answer (labels joined with `, ` for `multiSelect`, the Other text as is), `data` is base64. The route alone accepts a body up to 64 MB. Refusals are the codes of `Dispatcher.answerable` (`docs/chain.md`).
