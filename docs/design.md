# Design of the page

How a screen of Even Keel looks and how to tell that a new one is done. Read it before building or reworking a page, a panel, a card, a dialog or a step of a wizard; a screen is not done until its shots pass [the check](#the-check) at the end.

The rules are taken from the screens that work, not invented: what the stats page and the project page do, and what the maintainer turned down on the others (2026-10-24). "Make it look good" says nothing to a session; each rule can be checked on a screenshot.

## Subtopics

This file holds what every screen needs: the bar, the layout, the content and the check. The values and the blocks are in `docs/design/`, a file each: **before you change a stylesheet, a shared block or a form, read the whole file of that subtopic** — the project's standard gives a session this file alone ([As a standard](#as-a-standard)). A new rule goes into the file of its subtopic; a new subtopic is a new file and a row here.

| File | What is in it |
| --- | --- |
| [`tokens.md`](design/tokens.md) | Colour, type, space, radius and motion tokens, a component's own variables; the guards of `design.test.ts` and their baselines |
| [`blocks.md`](design/blocks.md) | Cards, facts, nested groups, dividers; plaques, count badges, centring by letter height, the run label; bands, toasts, downloads; folds, the loader, modals, the wizard; command and code blocks; buttons, row actions, the ⋯ menu, close, targets; tips |
| [`fields.md`](design/fields.md) | Setting, switch, segmented choice, provider choice, text area, secret and suggest fields; the "?" instead of a line under a field, the field strip, the error of a whole form |

## The bar

- **`/stats`** — a column of cards, each with a title that reads as a title, tiles with one big number and a muted label, a filter rail at the left, every chart with its legend, folded sections that say in one line what is inside.
- **The project page** (`/p/<id>`, a task picked) — the chain, the drawer at the right with facts in small boxes (uppercase label, value), one primary button, the problem in a red band with its action next to it.
- **The home page** — a grid of project cards of one height, the launch chart in a card.

Turned down, not to be copied:

- **`/status`** before BTN-357 — a list at the left and one item at the right with a single word "connected", the rest of a 2560 px screen empty, a table whose second column says "just now" in every row, the same fact as a dot, a word and a "Connection: connected" line.
- **The settings "Access" tab** before BTN-355 — environment variable names as labels, a "set" chip, a field and two buttons per row.
- **The project wizard and the first run** before BTN-344/BTN-346 — a form in a box glued to the left edge, steps as numbered grey captions between lines.

## Layout

- **A page** is the title row — `PageHead`: the 22 px title, its help tip, the page's actions at the right (`/stats`, the home page) — and the content under it (`.page`). The column is the whole width (`--column`).
- **No half-empty screen.** Content that is narrow by nature — a form, a list of settings, a wizard, a short status — is centred with a `max-width`, or the free side holds content of its own. A block glued to the left with the right half of the screen empty is a defect; look at it at 1600 px and wider, not only at 1280.
- **Settings form** (BTN-1727) — a settings screen is one column: each name over its control, all at one left edge (`Field`; the controls are in [`fields.md`](design/fields.md)). A control's `width` follows what it holds: text fills the column, `number` 120 px, `tokens` 160 px, `select` 240 px, `fit` its own (a button, a segmented choice). Only a switch keeps its name's line, at the column's right edge (`SwitchField`). Fields that depend on a switch go under it in `settings__nested`; numbers of one meaning share a line, each under its label. No lines between fields; no card of one field — it joins a neighbour card under a `SectionLabel`. The column is at most 680 px, centred with the groups' menu on `/settings`, the whole width in the side panel and when narrow. A row whose control stands at the right of its name is counted by a guard (`rowRules.ts`, [`tokens.md`](design/tokens.md#guards)).
- **List and detail** (a list at the left, the picked item at the right) only when an item's detail is large: a transcript, a long form, a task. When each item has two to six facts, show all items at once as cards in a grid.
- **Cards in a row are one height** and their buttons stand on one line at the bottom. The home page's project cards share their row's slots (BTN-1022: `grid-template-rows: subgrid` over four rows — head, bar, body, buttons), so a name wrapping to two or three lines moves the bars and the text of the whole row together, never one card's alone; whatever a card shows between the bar and the buttons is one `.card__body`.
- **Narrow** is 760 px and below (`useNarrow`): one column, the settings groups in a drawer, nothing cut. Wide is 1200 px and up (`useWide`).
- **Nothing jumps.** An edit, a mark or a scrollbar showing up moves nothing else. A scrolling box (`.panel`, the task card's body, a dialog's body) keeps `scrollbar-gutter: stable` and takes the gutter out of its right padding (`calc(<padding> - var(--pane-scrollbar))`), so its content is one width with or without the bar. A mark that comes with a change goes into a line that is already there (the ↺ of a changed setting in the field's head), never a new line under the field; a control that shows up in a row is no taller than the row.

## Content

- **One fact once.** A state is a dot and a word in one place; it is not repeated as a heading, a line and a table cell.
- **A problem has its fix next to it**: the button that fixes it, or the link to the place where it is fixed, named as the page labels that place.
- **An empty state** says what is missing and has the button that adds it: `EmptyState` (the home page without projects); a list's empty line is `*__empty` with its own button.
- **Words, not internals.** A person reads labels; a variable name, a config path, a CLI flag, `/usage` or a raw id go into a tip or nowhere. A project is named by its label (`ProjectLabel`), never by its id.
- **A table** only when its columns differ from row to row. A column that says the same thing in every row becomes one line above the table ("all read within a minute"), and only the rows that differ are marked.
- **Facts are never glued** (BTN-1370, BTN-1373): no two facts share a line joined by ` · ` (nor `•`, `|` or `—` as a separator); each value stands in its own column, fact cell or plaque. The model's label "Claude | opus" is the one accepted `|`. A guard counts every `·` the page can show ([`tokens.md`](design/tokens.md#guards)); a task that clears an area's glues lowers its counts. In place of a glue:
  - a word and a number — the word and a grey `.count-badge` ("Comments (2)");
  - two facts of one level — columns with a heading or captioned fact cells (branch and folder, not "branch · folder");
  - a secondary fact — a tip (`useTip`), not after a dot;
  - a level or a state — an icon or a lamp;
  - a list of like things — tags;
  - a name built of parts — an icon and a name, a key a tag beside it.
- **A tip of several facts** has each fact on a line of its own, "caption: value": `TipFacts` (`web/src/ui/TipFacts.tsx`, BTN-1379) draws a head, the captions and values as two columns (`.tip-facts`) and the notes a sentence a line — a limit's tip reads "5-hour limit", then "Resets in 1h 59m" and "Source /usage, just now"; a native `title` holds the same lines as "Caption: value" (`titleLines`, `Limits.tsx`).
- **Long text goes into a tip**; a card holds what is read at a glance. Where a line runs short, only a name takes an ellipsis — on a chain row the model of the run label, never its provider or effort (Run label in [`blocks.md`](design/blocks.md)).
- **Time** (BTN-613) — a time before each line of a feed (Activity in the session panel and the session window) is "16:05": a 24-hour clock in every language, no seconds, no AM/PM, 11 px muted, written only on a line whose minute differs from the last written one (`formatLineTime`, `minuteMarks` in `web/src/format.ts`); the cell keeps its width on every line. A list of past things (the sessions of a task) shows today's by its time and an earlier day's by a short date, "Oct 30" (`formatStamp`). The full date with seconds is the tip of the time (`formatFullTime`), on every line, written or not. The chat keeps its own: the time in the margin, shown on pointing (`LineTime`). Any hour on the page is h23 (`clock24.test.ts`).
- **Order by what the person looks for first**: the state and the problem at the top, details under them, settings and rare actions last.

## The check

Before the merge, for every screen the task built or changed:

1. Shoot it with `npm run shot` (`docs/web/screenshots.md`) in the dark theme at 1600×1000 and at 390×844, and each of its states the fake data can show (empty, an error, a long name); then once in the light theme, which only must not break. What the screen hides until a click — a fold, a tab, a menu, a dialog — is opened with `--click` and shot open: a control nobody shot is a control nobody checked (BTN-449 merged unstyled text fields under a closed disclosure).
2. Open each picture and answer every line; a "no" is fixed before the merge, not noted:
   - Is any part of the screen empty while the content is squeezed or glued to one side?
   - Does every title read as a title, larger and bolder than the text under it, and every group sit in a card?
   - Is any fact shown twice, or any table column the same in every row?
   - Is there a variable name, a path, a flag, an id or a code in the text a person reads?
   - Does every problem on the screen have its action next to it, and every empty state its button?
   - Is there more than one primary button in a card or a dialog?
   - Is every colour, size, weight, radius and gap one of the tokens of `docs/design/tokens.md`?
   - Does it look like it belongs next to `/stats` and the project page?
3. Write each question above with its answer into `.temp/design-check.md`, after the shots, and name the shots and the answers in the closing comment of the task.

## As a standard

A project makes this document binding through its setting "Standards" (Project settings → Sessions; `docs/sessions/protection.md`, "Project standards"). The button `Add "Interface"` adds it with the masks of the interface files (`**/*.tsx`, `**/*.jsx`, `**/*.vue`, `**/*.svelte`, `**/*.css`, `**/*.scss`, `**/*.html`, except `**/*.test.*`) and "Shots and answers before the merge" on. Then a session gets the document with its first read of such a file, is refused an edit of one before it, and its merge of a branch that changed one waits until `.temp/shot/` has pictures newer than the last change and `.temp/design-check.md`, newer than the pictures, holds every question of "The check" with an answer. The questions are read from the list items of "The check" that end with "?": a new rule there is a new question, and a line that is no question must not end with one.

The session gets this file only, not the subtopics of `docs/design/`, so "The check" stays here. A project that wants the subtopics given too adds each as a standard of its own with the same masks and the shots off: a document without "The check" asks for no answers.
