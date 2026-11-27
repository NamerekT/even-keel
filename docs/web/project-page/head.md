# The project page: the head, chats and the changelog

## The project head

`web/src/pages/Project.tsx`, `project.css`: the key, the display name and the tracker read on the left; the chain's buttons, the run strip and the side tabs on the right.

### The tracker read

`TrackerRead` is a refresh icon that reads the project's tasks now (`POST /api/chain/refresh` with `{project}`; the icon spins while it runs). "updated N ago" from `trackers[].readAt[<key>]`, the time of the project's last successful read, is the button's tip and stands beside it, amber, only while the tracker is down or the project was not read for over 3 minutes (`readLate` in `web/src/pages/status.ts`, BTN-1042). The poll is every 30 s; the button is for a change made in the tracker a moment ago.

### The name

- **Edited in place.** The name is the config's `projects[].name` (`projectName` in `web/src/state.ts`); `ProjectName.tsx` edits it in place — a click turns it into an input, Enter or leaving it saves through `project/settings`, Escape cancels.
- **No name yet.** A project without a name shows "Add a name" only while the key is pointed at or the button has the keyboard's focus, folded to nothing otherwise; a touch screen (`hover: none`) never shows it, and the name is added in the settings' "Repository" tab, where the same editor is a field ("Project name", saved at once, outside the tab's draft).
- **Everywhere else** a project is named by `web/src/ui/ProjectLabel.tsx` — the key, then the name when there is one: the header's crumb, the account menu, the queue panel, the home card, the launch chart's legend.

### The chain's buttons and the run strip

- **The buttons.** The two buttons that change the chain are one block of segments at any width (`.hblock.project__buttons`, BTN-1042), the primary one filled, each an icon before its word, the icon alone up to 760 px; why a button is off is that button's `title`, not a line. A greyed button of the pair (a running chain's "Start", "already running", `firstControl`, BTN-1312) is dimmed whole, while a pressable one beside the filled one has a ring. A button whose word changes slides to its new width and fades the new word in (`web/src/ui/Morph.tsx`).
- **The run strip.** The chain's state — running, paused, waiting — hangs under them as a field's strip (`docs/design/fields.md`, "Field strip"), tinted as its chip (`.project__run`, BTN-1162), its whole text in a tip, so nothing under the head appears on a press; on a desktop it takes no part of the line's height, so the buttons stand level with the title and the head keeps the room under them (`--run-strip`), a wait's line stepping down past it.
- **What the strip says** only describes the run, the whole of it in the strip's tip, so a press or a passing wait moves nothing under the head: "stopping" for a chain told to stop after its session's turn, "waiting", the wait's full line in the tip, "queued" with its place as a small grey `.count-badge`, the place and the project it waits behind in the tip (BTN-1374). The queue panel's chip and the home card's "In queue" take the same badge, the reason of a wait in their tip.
- **A wait the person fixes** — packages that fail, a slot, a folder — keeps its line and button under the head.
- **Landings first.** The landings (a merge on its way to the main branch: `docs/web.md`, "Terms") come first in `chainWaits` (`web/src/waits.ts`, BTN-1582), even while the head lane has a current task, from `chain.landings` (the dispatcher's landing records by project, without the session's message; `resolvingLanding`/`remoteLandings` of `src/chain/landing-hold.ts`):
  - `landing` — a task resolves its landing and the next task waits ("waiting", the task in the tip; not with the project's `landingHold` off);
  - `remote` — a task waits for the remote to push its merge, a line under the head with "Close without pushing" (`chain/closeUnpushed` with `{project, task}`; the dispatcher's refusals `landing.notWaiting` and `landing.notClosed`, `docs/chain/worktrees.md`); the home card shows the line without the button.
  - `?landing=resolving|remote` in `dev:fake` gives ABC's current task such a landing.

### "What sessions get"

Before the block stands the chip (BTN-615, `ToolsChip` in `web/src/pages/ToolsLink.tsx`): amber with the count while the project's settings have problems or the chain waits for the tracker's package, quiet while only the tracker's plugin is advised, absent when everything reaches the sessions or the settings are still being read. Its tip holds the count and the tracker's line; a press goes to the place the problem is fixed (`docs/packages.md`).

### The side tabs

- **The tabs.** The CI badge, "Backlog" with its count plaque, "Chats", "Settings" and the help "?" are tabs over the side column (`.side-tabs`), one strip: CI, Settings and "?" narrow ones — Settings only its icon with the word as its tip (`.side-tab--icon`, BTN-1231), so the strip holds in 400 px —, Backlog and Chats share the rest. The strip stands on the card under it; each opens its own card (`#ci`, `#backlog`, `#chats`, `#settings`, `#help`), and the open one takes the card's background.
- **Motion.** On a desktop the card's frame does not animate, only its content fades in (`fade-in`); up to 760 px the panel still slides in.
- **No side column** (under 1200 px with no panel open): they end the head row as the chip and the tags.

### On a phone

Up to 760 px the head is built from the header's blocks (`.hblock`, the `look` of `chipLook.ts`): the title row holds the key, the name and the chips; the next row is the tools' block alone, across the whole width with equal segments — CI with its dot and clock, the backlog's icon and count, the chats' icon and badge, the settings' icon, the "?" (BTN-1231); the row under it the view switch and the chain's block (BTN-1162). Up to 389 px their segments and gaps tighten.

## The changelog of a milestone

BTN-142, BTN-209, `web/src/pages/ChangelogDialog.tsx`. The server side and the freeze of a released section are in `docs/releases.md`.

### The button

A milestone head of the chain ends with a sheet-and-pen button (its tip says what it is) — not "no milestone", not the archive, not of a project without git (BTN-963: no branch to commit the file to, and its tasks change no code). Once the milestone's section has been written to the file it adds "+N since written": the done tasks of the milestone in `state.tasks` that the last written version does not account for (`state.changelogs`, counted by the page in `web/src/changelog.ts`). Where the tracker lacks `milestoneTasks` or the agent lacks `write` the button still shows and the window says so (`docs/sessions/chat.md`, "One-off turns").

### Opening

- **No agent on open.** The button opens a window that asks `changelog/open` at once, which never runs the agent (BTN-747): the newest version kept in the database comes back right away; without one, `ChangelogView.version` is `null` and `start` holds the milestone's done and open task counts and the section the file has now.
- **Before a first version** the window shows the counts, the file's section as it is (or "no draft yet") and only the primary "Write draft" (`changelog/draft`, the agent's first draft; a second `draft` returns the version it finds), greyed through `aria-disabled` with its reason at the left when no task is done. The edit box, "Add N", "Write again", "Copy", "Write" and the cost come with the first version.
- **While the agent works** — a first draft, "Write again", "Add N", an edit — the body is the page's loader (`Loading`, `fit="fill"`) with what it does. The window keeps one size whatever it holds, the text box taking the room left and scrolling, so it never jumps between the loader, a short draft and a long one.

### The version

- **Above the text**, under the counts: the version's number and time, or the file and the short commit it was written by ("already in" when the file had the text); how many done tasks the version accounts for and how many are open; the user's words of an edit; the tag a released milestone has.
- **Preview / Markdown** at its right (`Segmented`, kept in `localStorage` `even-keel.changelog.look` for every milestone, "Preview" by default). "Preview" renders the section through `SessionMarkdown` with no marks; "Markdown" shows it line by line against the version's `base` (`diffSection`, `src/changelog/diff.ts`): added lines green, removed ones struck through, a line with a few words replaced shows those words. The first version is compared with the file's section, so the user's own edits are not marked as the agent's.
- **The edit box** under it, "what to change": Enter sends `changelog/edit` with the words, Shift+Enter is a new line.

### The foot

The buttons never wrap or shrink.

- **The cost** at its left, cut with an ellipsis when short of room: what the version's turn cost (its tokens when the agent counts no cost) and, past one turn, "… in all" for every version of the milestone (`ChangelogView.spent`). Pointed at: the account folder, the model, the time, the tokens by kind, whether it came out of the account's limits or its API key's credit, and that `/stats` does not count these turns.
- **"Add N"** (`changelog/add`, only when N done tasks are not in the version), **"Write again"** (`changelog/again`).
- **"Copy"**: the clipboard API, else a hidden field inside the dialog and `execCommand('copy')` — plain HTTP from another host has no clipboard API.
- **"Write"** (`changelog/write`, primary, greyed once written).

### A released milestone

A released milestone whose newest version is written is frozen (EKR-129, `ChangelogView.frozen`): its version may be an old draft whose heading the release renamed and whose text was edited by hand.

- **What it shows**: the released section the file has now — the newest tagged version's (`newestReleased`, `src/changelog/file.ts`), no marks in "Markdown" — under "the released section as the file has it", or, when the file has none, the line that the section went out with the tag.
- **What it offers**: no edit box, no edit's words, no "Write again" or "Write" (the server refuses them with `changelog.released`); the foot keeps "Copy" of the shown section and "Add N", whose tip says the tasks go into a new section of the next patch. The version "Add N" makes is unwritten, so the window is the usual one again.

### Errors and limits

- **An error stays in the window** (`changelog.*` codes), with the notice's fix button (`noticeFixOf`), which closes the window on its way to the place.
- **A spent limit** of the account is `changelog.limitSpent` (EKR-130, `src/changelog/limit.ts`): the account, its window and reset. The server refuses before the turn when the account's known limits already have a window used up past now (`spentLimitOf`), and after it when the CLI's answer is a 429 or `usage_limit_reached` (`limitRefusalIn`), the CLI's raw answer only in the log; its fix is the project's Sessions tab. The account is never switched for a draft.

## The Chats tab

BTN-1231; `ChatsPanel.tsx`, `ProjectChatWindow.tsx`, `NewChatDialog.tsx`, the pure rules in `projectChats.ts`, styles in `chats.css`, words in `web/src/i18n/chats-*.ts`. How project chats work is in `docs/sessions/project-chats.md`. The fake is `?chats=none|many|long|packages|empty` (`docs/web/fake-states.md`).

### The list and the badge

- **Not in the live state.** `useProjectChats` on the project page asks `chats/list` every 4 s while the page is open, which gives both the list and the tab's badge — amber with the count of chats waiting for the user, else blue with the unread answers (`chatsBadge`).
- **The card** opens at `#chats` and on a phone takes the whole screen as Backlog does. "Active" with its count as a `.count-badge` (`ActiveTab`, BTN-1377) and "Archive" are the settings' group tabs.
- **"New session"** sticks to the card's bottom right in the Active tab, with chats or without: the empty state is only its line, no button of its own (BTN-1349).
- **The archive** is compact rows searched by title and messages (300 ms after typing), pages of 20 with ‹ › and no total; a chat that went on in a new session shows "→" and its successor's title instead of its message.

### A chat's card

- **The head row**: the agent's icon in the state's colour (`chatTone`: working blue, waiting amber, answered green, cold grey, error red), the title with a blue dot while unread, a chip for a question, work or a cold cache (on a phone "?" and "…") and the time of the last event.
- **The tags under it**, from the card's left edge:
  - the chat's machine as the chain labels it (`MachineTag` with a `title`, so no link inside the card's button), only when the project's pool (`state.pools`) has more than one machine (BTN-1614);
  - the account's pill (`AccountTag`); on a card whose icon is grey — a cold, new or archived chat — `muted` (BTN-1493), the account's colour only in its dot, so a cold chat does not read as a live one;
  - the model's short name (`modelText`, `shortModel`: "Sonnet 5.5", the catalogue's name of an OpenCode model as `ChatCard.modelTitle` carries it, BTN-1348) with the effort's bar scale (`EffortBars`, BTN-1369; the full name with the id and the effort's word in the tag's tip), a `free` tag after it for OpenRouter's `:free`, and `ctx N%`.
- **The last message** in a box of its own, up to three lines, led by whose it is.
- **The ⋯ menu** right of the time (BTN-1775, `ChatMenu.tsx`), a sibling of the card's button over its corner, so a press on it opens no chat; the same menu stands left of ✕ in the chat window's head (`TranscriptWindow`'s `headMenu`), never in a chain session's window. Its one list (`chatActions`) is Archive (`chats/hide`) for a chat with a session in any state — greyed with why while a first session still launches — or Delete (`chats/delete`) for an empty one, both red and without a confirmation. The card slides right and fades out (a fade alone with reduced motion), an action from the window closes it first, and a refusal brings the card back with the reason over the list.

### The chat's window

A chat opens the session's transcript window (`TranscriptWindow` with the chat's field as its foot): no commands menu (`ComposerBox commands={false}`), a question answered in place, an unread chat marked read (`chats/read`); an archived one is read only, with "Continue in a new session". A chat that goes on from another has "Continued from <title>" under the window's head (`TranscriptWindow`'s `lead`), the title read with `chats/chat`, a press opening the archived one.

### "New session"

`NewChatDialog` over the shared form `ChatChoiceForm` and its state `useChatChoice` (`web/src/pages/ChatChoiceForm.tsx`, BTN-1710). "Start chat" (`chats/create`) opens the empty chat window, and the session starts with the first message.

- **The machine.** The dialog asks `chats/machines` on open; with more than one machine it starts with "Machine", one `Select` of them with the machine's icon (BTN-1595). The last choice's machine is preselected while it can take a chat, else the one the server would pick (`machineFirst`); one off the link or without the project's folder is unavailable, its reason under the name.
- **The accounts** are the picked machine's (`machinePanel`: the own one's live, one elsewhere's from the answer), and one the new machine lacks gives way to the first open one (`accountAfter`). They are listed by agent, each agent's head a fold toggle (`FoldToggle`/`FoldBody`): the agent of the account offered unfolded once the machines are known, the others folded, a fold by hand kept over a change of the machine (`agentsOpen`, `agentToggled`), a folded agent naming the account picked in it at the head's right.
- **An account's row**: its 5-hour and weekly bars (the tip heads with the window, then "Used" and "Resets in" as captioned rows, `barTip`), the tag "chain" on the account whose pool runs the project, an account at its limit greyed with "limit until 19:20".
- **The model** of the picked account's agent and its effort, the project's last choice preselected.
- **"More"** at the foot's left (BTN-1696) opens `ChatExtrasDialog` over it: the project's packages by group as the project page groups them (`chatPackageGroups`, `web/src/pages/chatPackages.ts`), each row the short name with "On in Even Keel" / "in the project" / "for this chat" under it (the chat's own value in the accent colour, what the level above gives in its tip) and a Segmented "As above / On / Off". The built-in package says "On in every session" with no switch; a value of a package the project no longer has is a row of its own with the warning and "Reset" (`goneChoices`). "Done" closes it; the count of own values sits on "More", and `chats/create` gets `packages` only when there are some.

### A cold chat or a spent limit

A message to a chat whose cache went cold or whose account is at its limit (`chatRenewal`, BTN-1232) opens `ChatRenewDialog` instead of going out.

- **The why**: the title ("The cache went cold" / "<account> hit the limit"), one line in a few words (`RenewWhy`, BTN-1377) — amber "Went cold 5 min ago", or red "5-hour limit spent" — with an "i" after it whose tip says how many tokens a reply rereads or, as a captioned row, when the window resets; then the message quoted.
- **The choice**: one row of the account (the chat's machine's accounts, `useChatAccounts`; its agent as the option's icon, an account at its limit or signed out unavailable), the model and the effort, preselected by `renewalChoice`.
- **The foot**: Cancel, "Reply here" (cold only, sends as usual) and the primary "New session with this message" joined with its "?" (`ButtonWithTip`), which says what the new session gets. On a phone the buttons stand one under another, the primary on top, Cancel last.
- **The outcome.** The new chat (`chats/renew`) replaces the window's chat at once; Cancel keeps the text and files.

## The Legend

The "?" tab (`web/src/pages/HelpPanel.tsx`, samples in `HelpSamples.tsx`) groups marks by location: top header, project row, side panel tabs, task card and session strip.

- **Shared parts.** QueueContents, WaitingContents and AccountName are shared with the actual header, using the current chain count, names and account colours. CacheRing, priority numbers and the remaining icons use their page components and styles.
- **Lamps and counters.** Task state lamps are separate from priority numbers; the lock counters (blockers), key counters (dependents) and lock replacing a lamp (blocker outside the chain) have separate explanations.
- **What shows.** All state lamps and priorities are explained even on an empty chain; rework, the question label's amber corner and family rails appear when the chain has them.
- The panel leaves the chain visible for comparison. Samples are inert; Escape closes the panel.
