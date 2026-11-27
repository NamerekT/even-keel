# The session panel and the chat window

A starting session, the session's facts, the chat with the current session, the task panel and the window's frame and head. The chat's field and status line are in `composer.md`, the turn line and delivery in `turn.md`.

## A starting session

`sessionStart` in `web/src/state.ts`, `web/src/ui/SessionStart.tsx`: the current task's row shows a pill with the phase and the time since the start began, the row shimmers and its lamp is a blinking ring; the session panel shows a loading card with three steps instead of the session's facts.

- **The phases.** `launch`, `handover` and `resume` while `CurrentTask.starting` is set (the dispatcher is preparing the worktree, handing over, or — `CurrentTask.move` is `resume` — continuing the same session after a limit or a temporary error, EKR-120); `boot` while the page does not see the new session id yet, and while it sees it idle before its prompt lands; `answer` while that session works and its context is still empty (its feed is shown under the card).
- **Idle before the prompt** (`idleBeforePrompt`): the CLI's idle reads as `waiting`, but with an empty context and feed, no question, no startup dialog and no API error it is no wait for a reply — the row, the header's "waiting for a reply" and the tab badge leave it out too, until the 5 minutes below are over.
- **The time** counts from the journal row of the new session; after 5 minutes the page stops calling it a start.
- **Delivering the user's answer is no start**: while the dispatcher stops the session and resumes it in place (`CurrentTask.answering` next to `starting`), the page shows that session at work (`working`, no open question) instead of a stopped one, so the chat does not say it has finished.
- **Nor is what follows**: a session whose journal run has an answer or a resume gets no phase, though its respawned process is fresh and its context may still be empty (a first turn that ended on `AskUserQuestion` has no assistant message in the transcript yet).

## The session's facts

`SessionBody` in `web/src/pages/SessionPanel.tsx`, fact components and `TipValue` in `web/src/pages/SessionFacts.tsx`, styles in `web/src/pages/facts.css`.

- **Quiet until they need attention.** Time, Cache, Context and Tokens are small muted figures, and only the session state is always loud. A tile turns loud by the `tone` of its `Fact` (`web/src/ui/blocks.tsx`), `warn` or `danger`: Context from the `warn` and `danger` thresholds of the scale against the session's own window (`contextFill`, `SessionView.contextWindow`; tokens alone until the agent reports a window; BTN-187, `docs/sessions.md`), Cache in the last fifth of its lifetime and once it is cold (`cacheTone`; a finished session stays quiet), Time and Tokens never.
- **A fact is its figure alone**; the details are a tip opened by pointing at the figure or pressing it (`TipValue`, `web/src/ui/useTip.ts`, the same tip as the chain blocks' counters): Time the session's start, Cache its lifetime, Model the provider, the model and the effort, Tokens the split by kind.
- **Model** (`ModelFact`, BTN-1098) is the model and the effort of the last answer from the transcript (`SessionView.model`, `effort`): the model's short name — "Opus 5.5", "GPT-5.1", the catalogue's name of an OpenCode model (`SessionView.modelTitle`), with a `free` badge for OpenRouter's `:free` (`ModelName`, `shortModel` in `web/src/ui/modelLabel.ts`, BTN-1348) — and the effort's bar scale as a task's run tag (`EffortBars`, BTN-1369). The tip has the full name with the id and the effort's word: only the model's tail is cut, the badge and the scale stay whole, and an agent that writes no effort shows the model alone. For other agents than Claude the value starts with the provider and a vertical bar, as in the task's run tag.
- **Context** is one line (`ContextFact`, BTN-613, BTN-1374): the label, the bar, "38%" and "96k / 250k", as the CLI download meter; the chain row's and the chat's tips read "96k of 250k (38%)". It takes the whole row, Model and Tokens under it.
- **A past session's window** from "Sessions of the task" (`SessionWindow`) has the same rows — Started, Last turn and Worked, then "Context at the end", Model and Tokens, then separate Branch and Folder facts when recorded — from its record (`SessionRecord.agent`, `model`, `modelTitle`, `effort`; the agent is the account folder's the record was found in). In that window every fact is quiet.
- **The Activity feed** under the facts has no title: the feed itself is the press that opens the whole transcript, or the chat of the session the panel answers (`Feed.onChat`); a press that leaves selected text opens nothing, and from the keyboard the feed is a Tab stop opened by Enter or Space. A line's time is short, by the rule of [docs/design.md](../../design.md) ("Time").
- **Account pills** (`AccountTag`, `accountOf`) resolve a folder key first, then an e-mail within the session's agent when known. Every caller uses the session id to find its agent in the current session list; the chat can also take it directly from its target session. Without an agent, old records keep the first e-mail match. An e-mail belonging only to another agent leaves a neutral pill with the recorded address's name part. Stats and received-tools records use the same lookup; their own response formats carry no agent.

### Sessions of the task

In the task's session list the launch reason comes first. Resumes, answers and context compactions each have an icon and a count when positive, their tips explaining the events. Postponement, skipping and replacement each take a line of their own.

## The chat with the current session

BTN-101; invariant 1, exception 6. The chat is `TranscriptWindow` with a `chat` target (BTN-182). The question's styles are in `web/src/pages/ask.css`; the feed's, the calls' and the composer's in `web/src/pages/transcript.css`.

### Opening

- **The button.** The session panel of the chain's current task has a "Chat" button instead of "Open"; it is amber (`panel__chat--waiting`, the colour of `--lamp-waiting`) while the session waits for a reply. A press on the Activity feed opens the chat too.
- **Where there is no chat.** The read-only whole transcript is what the feed opens only where there is no chat: past sessions (`SessionWindow`) and blocks other than the current one — writing to a past session would fork the work.
- **During a fix of main.** While the fix session of a red main leads the chain (BTN-119), the task the chain takes next keeps the "Chat" button for its live session (`ChainBlock.aside`, `chainBlocks`), not amber, and the chat is locked with the hint that the reply waits for the fix: `Dispatcher.answerable` takes answers only for the current task, and the session is not answered from the page before the chain is back to it.

### The feed

- **Laid out like the Claude app**: no PROMPT/ANSWER labels, a centred column with no time column — the HH:MM of a line shows in the left margin while it is pointed at, the full date and seconds in its tip (`LineTime`); the calls are grouped (`media.md`, "Calls in the chat").
- **A user line** shows only what the user sent (`replyParts`, `docs/sessions.md`): the answers as a compact card on the left (`AnswerCard` in `web/src/pages/AskPanel.tsx`: each question bold with its answer under it; when the call is in the transcript the card opens into `AskCard`, the read-only question with the chosen options ✓ green, the rest dimmed), then the user's own words and files as a right-aligned bubble (`UserBubble`), folded past 8 lines or 600 characters with "Show more" right under the words and before the files (`SentFiles`). A bubble holding both words and files parts them with a line across its width (`.bubble--split`, BTN-1504).
- **Not shown**: a tool line of an `AskUserQuestion` that was answered or is open in the chat, since the answer card or the bottom stands for it; the error result through which a stop or a resume delivers its answer (`[Tool call interrupted: …]`, not a failed line); the synthetic `No response requested.` after it.
- **The session card's Activity feed** shows the same parts of a user line in one row, joined with ` · ` (`feedText` in `web/src/pages/feedLine.ts`).

### The open question

The open question is `AskPanel` at the bottom; a question asked in plain text gets `ChatComposer` instead: text, files and "Send".

- **The card.** Its head holds the question and a pager "1 of 3" between two chevron buttons (BTN-900) — the only count of the questions, a skipped one is reached by its arrows. Option rows with radio buttons or checkboxes (`multiSelect`), the label bold and the description muted, "Other" with a multiline field, a `preview` as a mono block beside the options, and "Skip" and "Next" — "Submit" on the last question.
- **Scrolling.** The head and the options scroll as one area (`.ask__scroll`, EKR-117: up to 50dvh, 40dvh on a screen up to 760 px), so a long question never pushes the options or the buttons off a phone; "Skip" and "Next" stay under it, and another question starts it from the top. On a phone the pager floats into the head's corner and the question flows around it.
- **The pager sits in the fieldset's legend**, so it still turns the questions while the reply is locked.
- **A pick does not advance by itself**, and a reply may skip questions — "Send" waits for any answer, text or file. The picks reset when the question's id changes and are not part of the draft.
- **An unsaved question.** A question known only from the job file (`ask.unsaved`, `docs/sessions.md`) gets a banner saying that a reply from here resumes the session without its last message, while Remote Control keeps it (`composer.md`, "Banners over the field").
- **Never offered twice.** The composer never offers a question the feed already holds an answer to (BTN-921, `shownAsk` over `answeredAsks` in `composerHold.ts`: an `answer` line of the transcript or a reply sent from this window), not out of its own memory, so a rebuilt chat, a reload or a late view of the session stopped and resumed to take the answer does not bring the panel back.

### Keys and the lock

- **Keys.** In both reply fields Enter sends or advances, Shift+Enter inserts a line, and Ctrl+Enter / Cmd+Enter also sends. `sendsReply` (`web/src/pages/chatKeys.ts`) leaves IME confirmation alone (`isComposing` or key code 229). On a coarse pointer (`useCoarsePointer`, `matchMedia('(pointer: coarse)')`) Enter only inserts a line: the buttons send or advance, and keyboard hints are hidden. Enter on a question's radio or checkbox neither submits nor advances.
- **Sending** clears the text and files at once and leaves the field available for the next draft.
- **The lock.** "Send" and the options of a question are locked unless `lamp` is `waiting` or `error` and the session waits on no startup dialog (`waitingFor` is `null` or it is asking). An idle API error says in the send button's tip that a reply resumes the session, while a retry still reported as `working` follows the usual mid-turn rules.
- **The hold after a send.** They stay locked after sending (`useHold`, 90 s or until the lamp, the open question or the session's last transcript line changes — `holdKey` in `web/src/pages/composerHold.ts`): a turn short enough to end between two updates of the state leaves the lamp `waiting` and the question as they were (BTN-220).

### The draft

The draft's text and files are kept per task in the browser's IndexedDB (EKR-24, BTN-948, `web/src/pages/chatDraft.ts`, database `even-keel` v2, store `taskDrafts`; `localStorage` cannot hold a `File`).

- **The key** is `draftKey(project, row id)`, since a task key is not unique across projects.
- **Reading and writing.** `useChatDraft` in `useChatDraft.ts` reads it as the composer opens — what was typed before the read finished wins — and writes it 400 ms after a change and as the window closes, so it outlives closing the chat, a handoff, the task's close and reloading the page.
- **The old store.** A draft of the store `chatDrafts`, kept by `sessionId` before BTN-948, is read when the task has none and moved to the task.
- **A send** clears the saved draft as it starts; a failed send prepends its text and files to the current draft and saves the reason, including when the window is closed.
- **Pruning.** Once per page load `App` prunes the task drafts of tasks the state no longer knows (`knownTasks`: `tasks`, closed ones too, and the keys of `taskSessions`) and the old session drafts of sessions it no longer knows (`knownSessions`), leaving any written in the last 24 h, since right after a start the service may not have read it yet (`staleDrafts`).
- **No IndexedDB** (a private window may refuse it): the draft lives only while the window is open.

### One window through replies, handoffs and Done

- **One chat window per task** (BTN-948): neither the window nor its composer is keyed by the session, so a handoff to a new session swaps only the feed (`TranscriptWindow` resets its lines, sent lines and viewer on a new `sessionId`, the composer its pending question and cold-cache dialog) without closing and reopening the dialog; a draft outlives a new question and a handoff.
- **A reply** stops the session and resumes it, so for a few seconds it drops out of the state: the open chat keeps its last session (`lastTalking` in `SessionPanel.tsx`) instead of closing and reopening; so does a handoff until the new session is up.
- **Done does not close an open chat** (BTN-948): it stays on the last session with the field kept and shut by "the task is closed" (`closed` on the composer; BTN-558 refuses a message after the merge anyway). That session is taken from the state as it is now, not as the chat last saw it (`chatSessionOf` in `web/src/pages/chatSession.ts`, BTN-1018): the merge lands before the session writes its closing message, so the window reads the transcript to the end of the turn — the message shows and the turn line goes out with the `working` lamp — and stops reading once the session is `finished` or gone from the state.
- **The panel waits for the chat.** The project page holds the panel on the closed task while the chat is open — the move to the next open task (`focusAfterClose`) waits until the chat closes (`nextOpenAfter`, `onChatting` of `SessionPanel`).
- **A shut field.** Every transcript window of a task has the field, not only the chat: one opened from the feed of a block without a chat or from the session list gets `ShutComposer` — the same `ComposerBox` with the task's draft, "Send" off and the reason in its placeholder and the send button's tip (the task is closed; the session has finished; otherwise sessions are answered in the task's chat).

### An answer sent

- **At once in the feed.** A sent answer shows as an optimistic line, kept until a prompt or answer line appears after it in the transcript: Submit puts it in the feed and takes the question's panel away before the server answers (`sendAhead`). While the answer is delivered the feed holds only its answer card, never the open question's card.
- **A refusal** marks the line as not delivered (its answer card goes, the delivery mark of `turn.md`) and brings the panel back with its picks and the command's error.
- **The panel's motion.** It slides up out of the field through `appear` and leaves sliding down through `fold`, in a `FoldPresence` (`.chat__ask`) whose height moves with it, so the feed above glides; with reduced motion it shows and goes at once.

## The chat's task panel

BTN-891, `ChatTaskPanel` in `web/src/pages/ChatTaskPanel.tsx`, styles in `chatTask.css`: the task's description, attachments and comments beside the session, so that a reply does not need the card closed and reopened.

- **The switch.** A chat of a session with a task (not an own-named block such as `ABC-FIX`) has a sidebar switch at the left of its head (`TaskToggle`, `SidebarIcon`), pressed while the panel is open; the task key after it is a link-styled button doing the same, the title is not. On a desktop the switch's tip shows its shortcut on a second line.
- **The hotkey** is `chatTask` (`Mod+B`, `docs/web/hotkeys.md`), handled on the chat dialog's `onKeyDown` so it works in the reply field too.
- **Remembered.** Whether the panel is open is kept in `localStorage` (`even-keel.chat.taskPanel`), and the chat opens as it was last left.
- **Its place.** A column at the left of the feed (`--chat-task-width`), the window wider by it; below 1180 px of screen it lies over the feed under the head instead of squeezing it.
- **Its motion.** A press slides it in and out through `appear`: its width and the window's change together, so the feed keeps its width, and its content comes from under the window's left edge (`@starting-style` for `chat-task--slide`; `chat-task--leaving` keeps it on the page until its width transition ends, at once with reduced motion). A chat that opens with the panel shows it without the slide.
- **Read only**: the status pill, the title, the description, `Attachments` and `CardJournal` without an editor, in the card's own components (`CardText.tsx`: `cardMarkdown` and `StatusPill`), and at the bottom "Open the card", which closes the chat and opens the full card, where the task is edited and commented on; a task link in the text does the same for its task.
- **Reading the card.** Through the same cache as the card (`recallCard`/`rememberCard`), anew when the state's row of the task changes and when the session's lamp does; an unreadable card is the card's notice, a tracker without one the card's line, and the chat goes on working.
- **A narrow screen** (`useNarrow`): the switch and the key open the full card over the chat instead; closing it shows the same chat again, the draft in the field kept.
- **Escape** in a dialog over the session panel closes only that dialog: the panel's own Escape listener skips a key from inside an open `dialog`.

## The window's frame and head

- **The frame** (BTN-1356, `transcript.css`): the head is a band of its own, flush with the window's top and sides (`--chat-head` high), which the task panel lying over the feed starts under.
- **The head names only the task** (BTN-890): its key and title on one line, cut by an ellipsis (`TranscriptWindow`'s `task`, the panel's `block.id` and `block.title`; without a task the session's id and "Chat"/"Transcript"); the title's tip holds the full title and the session's id, and a press on the title copies the id.
- **Its buttons.** At its right stay the PR button, `↗` — the same link to the session on claude.ai as the session panel's `.panel__remote`, while the session has one — and the close button. The window opens with the focus on the close button, since focusing the title would open its tip.
- **The status line** at the window's bottom is in `composer.md`; the read-only transcript (no `chat`) keeps the same head and status line.
