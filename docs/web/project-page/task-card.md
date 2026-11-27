# The project page: the task card

The card of a task: opening and layout, the properties panel, task numbers in text, editing, subtasks, the journal, the description editor, drafts, attachments, adding tasks.

## Opening the card

`web/src/pages/TaskCard.tsx`, loaded lazily together with `react-markdown`.

- A task title in the backlog, in the session panel's head and of a locked blocker in the chain opens it. A press anywhere else on a chain row (all but its links and the meters on the right) opens the session panel: the key's link is stretched over the row.
- An open card is the `?task=<id>` parameter in the address, so "back" on a phone closes it. Links to other tasks inside the card replace the parameter without piling up history. (The project's packages are `?pkg=1`, `&add=<plugin>` with the add dialog over them: `ProjectPackages.tsx`, `docs/packages.md`.)
- Every open reads the card from the tracker. The last card read for each task stays in the tab's memory (`cardMemory.ts`, BTN-655: keyed by the project's GUID and the task, up to 200 cards, never in `localStorage`), so a card opened again shows at once while it is re-read, and the answer replaces it quietly. A failed re-read shows its error above the remembered card; a "no such task" forgets it. A change made in the card reads it anew and so updates the remembered one.
- The card stands near the top of the window, not in the middle (BTN-801), so a long task never moves and the head stays put: while a task is read it is at its full height with the loader in the body; once the content shows, a shorter one glides its bottom edge up (`useHeightGlide`, keyed by the shown card's id, `--motion-appear`). A linked task glides back to the full height for its read, a remembered one straight between the two heights. With reduced motion and on a full-screen card below 760 px nothing glides.
- Styles: `card.css` (dialog, head, body layout), `cardMain.css` (the left column), `cardSide.css` (the panel), `cardNarrow.css` (reduced motion and narrow screens, imported last).

## The text

- Markdown links leading inside the tracker are text, and those with a task number open its card.
- HTML inside Markdown is rendered through `rehype-raw` and cleaned by `rehype-sanitize`: Huly writes its tables as HTML.
- Bare task numbers in card descriptions, comments and journal entries open the referenced card through the same action as a relation. The Markdown plugin in `web/src/pages/cardTaskRefs.ts` recognizes whole task numbers using the live project prefixes and each feed's effective prefix. The chat's task panel shares the renderer. Code, existing links and addresses retain their Markdown behavior.

## The panel

The layout is two columns: the description and comments on the left, a panel on the right (on top below 900 px). The panel (BTN-1097, BTN-1283) sticks to the top of the body and is no taller than its visible part, so a long list of relations scrolls inside it while the description scrolls on its own; below 900 px it scrolls with the card. Each group is a block of its own (`.task-card__block`); the parent and each kind of relation carry a stripe of a lamp colour. The fake `?card=links` gives a card a parent and twelve related tasks.

- **The action**: "Into the chain" or "To the backlog" in a `ButtonWithTip`, what it does behind its "?", a refusal as a warn line under it. When each stands is in `chain-and-backlog.md`, "Into the chain and back".
- **Two facts**: "Estimate" (`card.estimate`) and "Time" — the agent's active time over the whole task, the `/stats` "Time" column, sent with the card as `activeS` (`docs/stats.md`). The time takes the warning tone over ×1.5 of the estimate (`cardTime.ts`, the "Within ×1.5" bound of `/stats`); a missing one is "—" and neither hides the row.
- **The milestone**: where the tracker has `milestones`/`moveMilestone` (`docs/trackers.md`) it is a `Select` that moves the task at once, without a confirmation: the new value shows right away and goes back with the error if the tracker refuses.
- **Labels** are plain tags, a `<Provider> | <model>` one among them. A question or excluding label is a callout above the description.
- **Attachments** stand between the facts and the relations ("Attachments" below).
- **Relations**: keys share one column width, the longest key of the card (`--ref-key`), so the titles start on one line.
- Section heads carry their number as a `task-card__count` pill: Attachments, Comments or Journal, Subtasks with closed/total ("Closed: n of m" in its tip).

### "Runs on"

`TaskRunPick.tsx`, BTN-508, BTN-983; under the milestone. It reads the task's run from `state.runs` (`runPickOf` in `runPick.ts`), not its labels.

- A provider `Select`, first the project's provider by its name with the "as the project" icon (`InheritIcon`, the words in its tip, BTN-1375).
- For a provider, a free model field suggesting the models of the project's account for it (`SuggestField`, `useModelCatalog`), the project's model as its placeholder.
- An effort `Select` under its own "Effort" label — the bare level or "default", with the levels of the provider picked, or of the project's one under "as the project" (`effortsOf`); absent where that provider takes none. A new provider clears the model and an effort it does not take (`withProvider`).
- A pick does not save. Save (or Enter in the model field) shows only when the pick differs from the run, at the right of the label so nothing below moves, and sends `POST /api/task/run` with the whole run (`runPickChange`; every field empty for no run). It touches no tracker, so the pick works on any adapter.
- A live session and a pending change get a note: the run takes effect from the task's next session (a record, not a touch of the session).

## Editing in the card

BTN-771: a task of the built-in tracker, whose card carries `edit`. `CardFields.tsx`, `CardLinks.tsx`, `CardTree.tsx`, `useCardEdit.ts`, the pure rules in `cardEdit.ts`, styles in `cardEdit.css`. The refusals are in `docs/trackers/builtin.md`; the fake is `?card=builtin|conflict` (`docs/web/fake-states.md`).

The card is where such a task changes, so it has no "Open in …" link and no "Into the chain"/"To the backlog" buttons: the status pick in the head does the same.

### Fields

- **Title** edits in place: Enter, leaving the field, closing the card or hiding the tab saves it, Escape drops it, an empty one is not saved.
- **Held values**: what was sent stands in the field from the moment it is left until the card is read anew, and a saved description in its view the same way (BTN-1111, `useHeld.ts`); only a refusal brings the old value back. A typed edit is kept in the browser until it lands ("Drafts" below).
- **Status** is a `Select` of the seven fixed statuses: Backlog → a `ToDo` status is `task/ready`, a `ToDo`/`Active` one → Backlog `task/unready` (off with its reason while a session is live or the chain refuses the task), anything else an `edit`.
- **Priority** is a `Select`.
- **Milestone** is a `SuggestField` creating a new one by its typed name, with a warning under it when the project's "Project tasks" rules leave that milestone out. A parent's milestone change asks whether its open subtasks move too (yes by default).
- **Labels** is a `SuggestField` of the project's labels and the built-in ones with their meaning; a new name creates the label.
- **Component** (BTN-1288, `ComponentField`) is a `SuggestField` of the project's components: typing filters them, a typed name no component has is offered as "create" (sent with `create: true`), × "No component" clears it.
- **Estimate** (BTN-1288, `CardEstimate.tsx`): the whole tile is its button, so an editable card shows the estimate and time tiles even before either is known. It opens a field in minutes with a "?" of the formats ("20", "1h 20m", "1.5h"; empty — no estimate): Enter saves through `builtin/estimate` (`estimateMinutes` in `cardTime.ts`), Escape or a press outside closes it, a text it cannot read keeps it open with a red line under it. "Time" is the sessions' and never edited.

### Relations and the parent

- "+ Add a link" opens the kind (`blocks`, `blocked by`, `relates to`) and a task search over every built-in project (`builtin/search`); a refusal stands under the search, × on a row removes the link.
- A subtask shows the path of its ancestors over the title (each opens its card) and a Parent field with ×; "Change the parent" (or "Pick a parent") searches the task's own project.
- Both searches send `for: {task, field}` (BTN-1589), and the service leaves out what it would refuse for that field: for a link the task itself and the tasks it already links by that kind, for a parent the task, its parent and its subtasks at any depth. A loop of blockers through other tasks is still found only by the refusal.
- A parent's "Subtasks" list gets "+ Add subtask" here, on an open task even without subtasks yet (none on a closed task): the subtask takes the parent's milestone and Todo. The first one of a task in work asks first, since the task leaves the chain while its session goes on.
- In the chain, a subtask's rail has the parent's key and title as its tip (`t.chain.family`), a press on it opening the parent in the "Parents" view; a backlog row of a subtask shows `↳ <parent key>`.

### Delete, conflicts, refusals

- "Delete" in the card's ⋯ menu asks, listing the subtasks that become top-level; it is off while the task is current or has a live session.
- Every field edit sends what the field held and the new value. A `builtin.conflict` opens "The task changed while you were editing it" with theirs and yours, "Keep mine" re-sending it over theirs; a refusal of any other kind is a band in the card.
- Escape in a dialog opened from the card closes only that dialog: `ConfirmDialog` stops `cancel`, which React passes up its tree.
- Lists opened from the card have a bounded width, a long title ending in "…".

## Subtasks

BTN-1152, `Subtasks` in `CardTree.tsx`. A task whose card gives `subtasks` (every tracker but Forgejo, `docs/trackers.md`) shows "Subtasks" with the closed and all counts under the description: its direct children in the chain's order (`chainOrdered`: the chain's ones first, the rest by number), each a key that opens its card with its status beside it. On any tracker but the built-in one the list is read-only and a task without subtasks shows no block. In the fake, a parent of the "Parents" view (`ABC-16`, `ABC-17`) has a card with the fake's tasks under it.

## The journal

BTN-774, `CardJournal.tsx`, the pure rules in `journalView.ts`. The fake is `?card=builtin&journal=empty|long|asked|history|history-long` (`docs/web/fake-states.md`).

### Order and authors

- Every tracker's comments go newest first (BTN-1451), the latest 20 shown and "N more" under them showing the older rest; the chat's task panel too. The session's chat itself keeps a messenger's order, the newest at the bottom.
- A built-in task's section is "Journal" with its count, its entries named "You" (the person's notes, framed in the accent), "Agent" with the model as a `RunLabelTag` beside the name (`journalModel`, once the comment carries it; BTN-1112) or "Even Keel" with its mark. Another tracker's comment keeps its author.
- The replies in a comment's thread (BTN-909, `TaskComment.replies`, only Huly gives them) stand indented under its bubble, oldest first (`repliesOf`), never folded and not counted in the heading; the chat's task panel shows them too.

### Changes in the stream

A built-in task's changes (BTN-1112, `CardChanges.tsx`, `cardChanges.css`, `journalItems`/`changeRows`) go into the same stream by time: no bubble, the head "who, when", then a table of the field's name and "before → after". A list field (labels, links, subtasks) is one row of added and struck-out chips; statuses are dots, the old one muted; a description is "Changed" with "Show difference" folding out red and green lines and "⋯ N lines" for an unchanged stretch.

- One author's changes within 5 minutes of the group's first are one entry (`groupChanges`), and the window of 20 counts entries after the filter.
- The heading's segmented filter All / Comments / Changes starts at All on each open.

### Notes (built-in only)

- The note field right under the heading and its filter, above the entries (BTN-1451), sends `builtin/comment` on Enter (Shift+Enter a new line; on a touch screen Enter is a new line and the send button sends). A line under it says a note does not reach the session: its questions are answered in the session's chat.
- A trash button on the person's own note asks and sends `builtin/uncomment`.
- An empty journal says what will appear in it.
- Closing the card asks nothing: an unsent note stays as the field's draft and is back in it on the next open, until it is sent or the field emptied.

## The description editor

BTN-772, a built-in task's card. `CardDescription.tsx` in the card's chunk; `DescriptionEditor.tsx` in its own lazy chunk with TipTap (~519 kB, ~163 kB gzip — the reason it loads only when a description is edited); the pure Markdown side in `descriptionDoc.ts`, `descriptionLoss.ts`, `descriptionPaste.ts`; styles in `description.css`. The fake is `?card=builtin&description=html|long|empty` and `?card=conflict` (`docs/web/fake-states.md`).

### The two views

- "Edit" by the heading (its tip says a double click on the text opens it too) turns the description into the editor. The text is always Markdown; the Preview/Markdown switch (a `Segmented`, remembered in `even-keel.description.look`) only changes how it is edited.
- Preview is TipTap with a toolbar (bold, italic, strike, code, H2, H3, lists, a checklist, a quote, a code block, a table, a link). It writes the text only on a real edit, so opening and closing it changes nothing, and an edit undone back is no change.
- The visual editor is off, with the reason as the switch's tip, when it would lose a part of the text: HTML, a footnote, a picture or anything it would write back otherwise (`previewLoss` compares the text with its round trip through the editor's schema). A table is written unpadded (`compactTable`).
- Markdown is a plain textarea; HTML pasted into it becomes Markdown (`htmlToMarkdown`).

### Files in the description

BTN-773, `useUploads.ts`, the pure side in `descriptionUpload.ts`. A file pasted (Ctrl+V) or dropped into either view becomes the task's attachment.

- One over the "Attachment size limit, MB" setting is refused before the upload with the `builtin.fileTooLarge` band and its button to Settings → Interface.
- Otherwise an "uploading…" mark goes in at the cursor and is replaced by `![name](../url)` for a raster picture or `[name](../url)` for anything else once the upload answers.
- The visual editor has no picture node, so a file in Preview switches to Markdown (not remembered) and the mark goes at the end.
- A drag over the editor shows the drop overlay; Save is off, with the hint saying so, while an upload pends.

### Saving and leaving

- Ctrl+Enter saves in both views (before ProseMirror's own Mod-Enter). Escape leaves, asking first when there are changes; Escape in that question closes only the question.
- Saving sends `builtin/edit` with `field: 'description'`, the text the editor started from and the new one, and nothing when they are equal.
- A `builtin.conflict` opens "The description changed while you were editing it": the new version against yours line by line (`DiffLines`, shared with the changelog), the count of the lines keeping yours would overwrite, "Keep mine" re-sending yours over theirs and "Take the new one" reopening the editor on theirs, with yours kept under it ("Your version": "Copy", "Put mine back") until the card closes.
- Closing the card (×, Escape, the backdrop) or the tab with the editor open saves the changes; hiding the tab saves them and keeps the editor open; only the editor's Cancel (and Escape inside it) drops them.

## Drafts

BTN-1027, `cardDrafts.ts`, `useLeaving.ts`.

- What the person typed into a built-in task's title, description or note is kept in `localStorage` under `even-keel.draft.<project GUID>.<task>.<field>` as `{ from, to }` from the moment it is sent until the service takes it; any refusal keeps it.
- `useLeaving` saves on `visibilitychange` → hidden, `pagehide` and unmount. A save sent as the page goes away is a `keepalive` request when its body fits 60 000 bytes (`fitsKeepalive`: the browser caps all in flight at 64 KiB), a plain one otherwise, which may not arrive.
- On the next open of the card a draft whose `to` the field does not hold yet is sent again over its own `from` (once per mount: React's strict mode runs a mount effect twice), so a field changed meanwhile opens the same conflict window. "Take the new one", Escape on the title and Cancel in the editor drop the draft.

## Body limits

BTN-1183. The server takes 64 KiB of JSON per request, but the built-in tracker's commands that carry a task's text (`builtin/create`, `edit`, `description`, `patch`, `comment`; `BUILTIN_BODY_LIMITS` in `src/builtin/routes.ts`) take 4 MiB, since the card's `edit` sends the old and the new description together. Past a limit the refusal `request.tooLarge` names it and says to shorten the text or attach a part as a file.

## Attachments

`Attachments.tsx`, styles in `media.css`.

- Every tracker's files are tiles — a picture, a video with its play mark, anything else its extension — each with its name (cut with "…", whole in the tip) and size.
- A picture tile is the full file loaded lazily. A video tile has no preview on purpose: without `Range` support even `preload=metadata` could pull the whole video.
- Only photos and videos open, in `MediaViewer.tsx` over the whole window (arrows, ←/→, swipe, a click on a picture zooms, Esc goes back to the card); any other file downloads.
- The viewer's name, counter and "Open" are a dock held to the window's bottom (BTN-1713, above the phone's safe area), the file fitted into the stage over it, so the dock stands in one place for any file. The name (BTN-1706) is cut in the middle so the extension stays; the counter keeps the width of "999 / 999" so the arrows never move, an arrow off rather than gone at either end; a single file has no counter.
- Only a built-in task's tile (BTN-773, the card carries `edit` and the file its `id`) has a trash button, shown on hover or focus and always on a touch screen. It asks "Delete the attachment?" (a link to it in the description stops opening) and sends `builtin/detach`.
- A record whose file is gone from the service's disk is a "No file" tile with the reason as its tip, still deletable. The fake is `?card=builtin&files=missing`.

## Adding tasks

BTN-770, a project a tracker view of kind `builtin` lists. `AddGhost.tsx`, `addGhost.css`, the pure rules in `web/src/ui/addGhost.ts`, the project's milestones with their status from `builtin/milestones` in `useProjectMilestones.ts`. The fake is `?tracker=builtin` (`docs/web/fake-states.md`).

### Where the ghost stands

- A dashed "+ Add task to the milestone <name>" ("+ Add task" in the group with no milestone) ends every chain group that shows its rows — not a folded one, not the archive, not a group the "Project tasks" rules shut out (`takesGhost`: a milestone `ownsMilestone` accepts, tasks with no milestone only when the rules let them in).
- A task made there is Todo with the group's milestone, so it enters the chain at once; while the chain runs, the ghost's tip says it is taken in its turn.
- A planned or active milestone with no task yet (`emptyMilestones`, `milestoneView`'s `empty`) is an empty group with only its ghost, placed by the milestones' order. A completed or canceled one without open tasks is not shown; its closed tasks are in the archive (BTN-1462).
- A project with no task at all has one "+ Add task" as its whole empty state (`looseGhost`). While the chain has no open task that ghost asks in the accent (`invite`, `.add-ghost--invite`), and its hover looks different from the asking, so the two stay apart. The Backlog tab's count of such a project stands at 0 too.
- The backlog panel has "+ Add task" on top: Backlog, no milestone, the new row unfolding under the ghost (`backlog__row--new`).

### Typing a task

- A press (mouse, Enter, Space) turns the ghost into a title field in the same place.
- Enter sends `builtin/create` (`project`, `title`, `status`, `milestone`) and keeps the field open and empty for the next one; Ctrl+Enter also opens the new task's card.
- Escape closes it, keeping its text as that ghost's draft (`draftKey`, in memory until the page reloads, never shared between tabs); leaving it closes only an empty one.
- A blank title creates nothing and says so under the field; a refusal stays there as its code's text with the title kept; a second Enter before the answer sends nothing.
