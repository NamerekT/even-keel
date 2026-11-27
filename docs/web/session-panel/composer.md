# The chat: the composer and the status line

The field under the chat's feed, the status line under it, the banners over it and the commands typed into it. How a reply is locked, held and kept as a draft is in `panel.md`, "The chat with the current session"; what happens to a message once it is sent is in `turn.md`.

## The status line

What the session is at goes into the status line under the field (`ChatStatus` in `web/src/pages/ChatStatus.tsx`). The read-only transcript (no `chat`) keeps the same line at its bottom, from the state's session or, for a past one, its record (`useStatusFacts`).

- **At the left: the branch and the lines changed.** The branch is `SessionView.branch` (the transcript's `gitBranch`; it gives up its room first). The lines changed (`chatEdits` in `web/src/pages/chatEdits.ts`, BTN-1424): in a tracker task's window the task's branch against the main branch as the service last read its folder (`EvenKeelState.diffs`, tip "Changes of the branch"), the same for every session of the task, so a handoff does not empty it, and nothing for a branch with no change; in a project chat, a fix of main or a task whose folder is not read (gone, no git, an older service) the session's own edits (`editTotals`, tip "Edits of the session").
- **Then the account and the model.** The account's tag, the model of the last answer by its short name as in the Model fact ("Opus 5.5", the `free` badge after it, `ModelName`) and its effort's bar scale; only the model's tail is cut, and a tip names the model's full name with its id and the effort. A task's run or the launch profile sets them, the chat never does.
- **At the right: the context ring** (`ringFacts` in `web/src/pages/contextRing.ts`). It fills by the context's share in the colours of the context meter and is dashed while the window's size is unknown. A press or Enter/Space opens a popover above it with the context's figures and bar — a mark where the session hands off (`GET /api/sessions/<id>/checkpoint`, unless its source is `off`) — and the account's card with its windows as the header shows them (`AccountCard` in `web/src/layout/AccountLevels.tsx`). A press outside or Escape closes it; that Escape does not close the chat.

## The box

- **One rounded box**: `+` for files and `/` for a command on the left, the send icon on the right, the microphone between the field and Send. `/` puts a slash into an empty field and opens the commands menu (`CommandTextHandle.startCommand`), and is off while the field holds text.
- **No hint line under the box** (BTN-1347). The placeholder is short ("Reply to the session…"); the keys are in the hotkeys window. Why sending is off — locked, being sent, just sent — is the placeholder of the empty field and the tip of the send button, which is then `aria-disabled` rather than `disabled` so the tip opens on it (`ComposerBox`'s `reason`; `sendTip` for a tip while sending is on, mid-turn or after an API error).
- **Height.** The field grows to 5 lines and scrolls inside after that.

## Dictation

The microphone (BTN-1343, `DictateButton` in `web/src/pages/DictateButton.tsx`, the pure parts in `dictation.ts`).

- **The browser's recognition**: `SpeechRecognition` or `webkitSpeechRecognition` in the page's language, no server part. A press keeps the field's text and writes after it, a space between, every result as it comes, interim ones included (`saidText`, `dictatedText`). A second press, the recognizer's own end, typing into the field, sending and closing the chat stop it.
- **Pointer kinds.** A fine pointer listens continuously, a touch screen stops at the first pause (Chrome on Android repeats phrases in a continuous session).
- **Its look.** While it listens the button is `aria-pressed`, lit in `--accent` with a breathing icon; an error leaves it amber with the reason and what to do in its tip (`dictationProblem`).
- **No button** where the browser has no recognition (Firefox) or the page is not a secure context (`speechRecognitionOf`).
- **Recording through the classifier's LiteLLM** (BTN-1391; the state's `dictation`, `dictationSettings` read live): a press records instead (`useRecording` in `web/src/pages/useRecording.ts`, the pure parts in `recording.ts`) — `MediaRecorder` in `audio/webm;codecs=opus` or `audio/mp4` (Safari); the button widens into a pill with the microphone in `--lamp-error` and the time (`chat__dictate--recording`). A second press, two minutes (`MAX_RECORDING_MS`), sending or closing the chat stops it, and the sound goes in base64 to `POST /api/dictation/transcribe` (`Dictation` in `src/dictation/transcribe.ts`, `docs/tally.md`) while a spinner stands in the icon's place (`chat__dictate--waiting`, disabled); the text is added after the field's like the browser's. Firefox gets the button in this mode, since it records.
- **A refusal** is a notice code in the button's tip (`dictation.*`) and, for the quota, an hour of the browser's recognition, five minutes after another failure (`fallbackUntil`); an empty or too long recording keeps the model.
- **dev:fake**: `?dictation=on` sets it, `slow`, `quota` and `failed` answer late or refuse (`fakeDictation`); `npm run shot` gives Chromium a fake microphone.

## Files

- **`+`.** With a mouse it opens the file picker at once; on a touch screen (`useCoarsePointer`) it opens a sheet from the bottom with Camera, Photos and Files (BTN-1342, `AttachButton` in `web/src/pages/ComposerFiles.tsx`), each a file input of its own (`ATTACH_SOURCES` in `fileTiles.ts`): Camera takes `capture="environment"`, Photos takes pictures and videos without `capture`, which Android answers with its photo picker and iOS with Photos, where a bare input offered only the camera and the file manager. A pick closes the sheet.
- **The strip.** The files wait at the field's top, a shelf flush with its edges, in one strip of tiles that scrolls sideways, a mouse wheel scrolling it too (`FileStrip`): a picture or a video by its preview (an object URL made once per file and revoked when the file leaves the field or the field goes, `syncUrls`), any other file by its extension and its name cut in the middle (`tileOf`, `shortStem`), each with a round cross in its corner.
- **A preview opens the viewer** (`.chat__view`, BTN-1388): `MediaViewer` on its file from the same object URL, no request to the service, paging through the strip's pictures and videos; the cross only removes, and a plain file's tile does not open.
- **Paste and drop** (BTN-204): files also come by Ctrl+V into the reply box and by a drop anywhere on the chat window, in the same states as `+` — any time but while a reply is being sent (`ComposerHandle.attach`).
  - A paste leaves text to the box as usual and takes the files of `clipboardData.items`; a picture the clipboard calls `image.png` becomes `paste-YYYYMMDD-HHMMSS.<ext>` by the local clock and its MIME type, so pastes do not merge into `image (2).png` (`takenFiles`, `pastedName` in `web/src/pages/chatFiles.ts`).
  - A drop (`useFileDrop`) keeps the files' names and skips folders and anything that is not a file, such as a link or a picture from another page that brings no file; while files are dragged over the window, `.chat__drop` covers it with a dashed frame and a line.
  - While the chat is open a file dropped elsewhere on the page — the backdrop — is refused rather than opened by the browser. The chain's cards are moved by pointer events, not HTML drag, so a file drag never starts `useChainDrag`.
  - Files copied in Explorer are not checked live (`docs/unverified.md`).

## On a phone

Up to 760 px the box is tighter for the phone's keyboard: 16 px text (iOS zooms into smaller), thinner paddings round the box and the window's body.

- **The keyboard hides the rest**: while the field has the focus the status line and the accept bar hide.
- **The draft's fold** (BTN-1700). A draft shows up to 5 lines focused or not; unfocused, it shows its start with no scroll and folds to 2 lines while the reader is up the feed (`data-feed-raised` on the window's body, `feedRaised` in `web/src/pages/feedPin.ts`), gliding through `fold`. Against a loop of the field's height moving the feed's end, it rises only when the reader took a free feed more than 120 px above its end — more than the three lines it gives back plus the pin's slack — and comes down only when the feed is pinned again; growing at the end keeps the feed pinned, as the pin's `ResizeObserver` follows the box.
- **Focus.** A press on `+`, `/` or Send keeps the focus so the box does not fold under the finger. The tap that focuses the field puts the caret at the end of the draft and scrolls the field there, whatever line the finger met; later taps place it as usual (BTN-1701: `CommandText` marks a pointer press on an unfocused field and moves the caret on its click, after the browser has placed it).
- **After a send.** A message sent with success takes the focus away (`CommandTextHandle.sent`), so the keyboard folds and the feed shows whole; a failed send keeps the focus and the text. Wider, a click places the caret where it lands and the focus stays after a send.
- **The visual viewport.** The window follows it (`useChatViewport`: `--chat-visible-height`/`--chat-visible-top` from `visualViewport`), so a keyboard that pans the page rather than resizing it leaves the head on screen; Android's Back, which closes the keyboard but keeps the focus, brings the status line back (`data-keyboard-closed`).

## Banners over the field

BTN-1363, `ComposerBanner` in `web/src/pages/ComposerBanner.tsx`, a `Band` with `chat-banner`. Under the field stands only the status line; everything else the composer says is a banner between the question's panel and the field, a few words at the left, its buttons and ✕ at the right, each in its own `FoldPresence` (`chat__banner`, the question panel's slide). The project chat has the error banner only.

- **A refused send or accept** is `error` (`role="alert"`): its ✕ drops the refusal from the draft (`dismissFailure` of `useChatDraft`, so a reload does not bring it back; an accept's refusal is hidden in the composer) and a refused accept has "Try again".
- **A question the CLI has not saved** (`ask.unsaved`) is `warn`, the explanation in the tip of its line, closed per question.
- **"Accept as answer"** (`offersAccept`) is `note`: "Close the task with this answer?" and the button, the explanation in the button's tip. Its ✕ closes it for the session's current turn, kept in `localStorage` (`acceptClosed.ts`: a session's id → the time of its feed's last line, the latest 200 sessions), so the next turn without a mark shows it again. On a phone it waits out the keyboard, as the status line.

## Commands

BTN-557, `docs/sessions/agents.md`, "CLI and transcripts". `ChatComposer`'s field is `CommandText` (`web/src/pages/CommandText.tsx`, styles in `chatCommands.css`), modelled on the commands of Claude Desktop. The pure parts are in `web/src/pages/chatCommands.ts` with their tests; the labels are `commands.menu`, `commands.filter` and `commands.groups` of the composer's i18n.

### The field

- **The menu.** A `/` at the start of the message opens a menu above the field (`menuQuery`, `matchingItems`): ↑/↓ move, Tab or Enter put the command in (`withCommand`), Esc closes, a click only puts it in; the row under the pointer shows its description beside the menu at once, over the menu below 760 px.
- **A known command** in the field is drawn in `--accent` by a mirror behind the textarea (the textarea's own text goes transparent while a command is in it, its caret stays), with its arguments hint muted after it until the user types them (`ghostOf`); the pointer resting on it shows a card with the name and the description.
- **One token.** A caret stepping into it selects it whole (`snappedSelection`), Backspace right after it or Delete right before it removes it whole (`tokenCut`).

### The menu's items

BTN-1695. `useChatMenu(project, task, agent, chat?)` (`web/src/pages/useChatMenu.ts`) gives `CommandText` a `ChatMenu`: Even Keel's commands (`CHAT_COMMANDS`, expanded by the hub) for a task's session, and for a Claude or Codex session the hub's answer to the query `chat/menu` {project, task?, chat?, agent} on top — read when the field mounts and again each time the menu opens (`refresh`), so a changed configuration or package set shows without a restart.

- **What the hub reads.** It builds the answer in `createMenuSource` (`src/sessions/menuSource.ts`) from what the session gets, never asking the session: `chatMenu` (`src/sessions/menu.ts`) reads the user's `commands/*.md` (top level only) and `skills/<folder>/SKILL.md` of the config copy (`configStore` of the global folder), then the same of each plugin folder of the project's packages (`Packages.pluginFolders(project, task, own)`, read only), named `<plugin>:<name>`. A project chat's window sends its id, and the hub takes the chat's own choice of packages (`ProjectChats.packagesOf`), as its launch does (BTN-1716).
- **Names and order.** A skill is named by its folder, `user-invocable: false` hides it, the description is its frontmatter's `description` (a small parser of its own, `frontmatterOf`); user entries come before package ones, each part sorted, the first of two equal names wins.
- **The trim.** A task's session with "Trim the tools" on drops the names its `skillOverrides` turn `off` (`trimSettings`, `src/tools/settings.ts`; `user-invocable-only` stays); a project chat (task null) gets no trim.
- **Groups.** `menuItems` (`chatCommands.ts`) joins the parts into groups `even-keel`, `user`, `package`, Even Keel's command winning on a name; the list shows a heading per group (`li.chat__commands-group`) only when it has more than one.
- **Sent as typed.** A user or package item goes to the session as typed (`commandPrompt` and `typedText` leave an unknown `/name` alone). Seen live (2026-11-26, `docs/verified/sessions.md`): the CLI expands it as the prompt of a `--bg` resume and of an Agent SDK turn, a mid-turn SDK message waiting for the turn's end; a live `--bg` session gets it through its inbox wrapped as another session's message, so the CLI does not expand it and the model calls the Skill tool itself.

### Codex's items

BTN-1737. Codex expands `$name` at a launch and a resume and takes `/name` as plain text (seen live, same entry), so the hub's part for `agent: codex` is what Codex calls by `$`.

- **Only skills** — the plugins' commands and the user's `commands/*.md` never reach Codex — of the same config copy (whose skills Even Keel links into `~/.agents/skills`, without the store's `synced` and `.trash`) and of the same package plugins (Codex installs them from its marketplace, `docs/packages/gateway.md`).
- **Names.** Codex names a skill by its frontmatter's `name` (the folder when there is none) and a plugin's as `<plugin>:<name>`, as the "Available skills" of its transcript shows (`tasks:task`); `user-invocable: false` still hides one; the trim's `skillOverrides` are Claude Code's, so a Codex menu has no subtraction. Nested `SKILL.md` folders, which Codex also reads, are not listed.
- **The sigil.** Each `MenuItem` carries its `sigil`: Even Keel's commands `/`, a Codex session's entries `$` (`menuItems(…, sigil)`). A pick puts `$name ` in (`withCommand`), the field draws `$name` as a command (`typedItem` matches an item by its own sigil, so `/name` of a `$` item stays plain text), and the menu opens on `/` with every item or on `$` with only the `$` ones (`menuQuery`, `matchingItems`).

### Other agents

Another agent's `agent` gets an empty list from the hub (a query without `agent` is Claude's), so it gets only Even Keel's commands. A project chat has no `/handoff`: a Claude or Codex chat shows only the hub's part, any other agent's gets no menu and no `/` button (`useChatMenu` gives `null`). dev:fake answers `chat/menu` with `FAKE_MENU` (`web/src/live/fakeMenu.ts`), only its skills for Codex.
