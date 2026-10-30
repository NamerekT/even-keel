# Design of the page

How a screen of Even Keel looks and how to tell that a new one is done. Read it before building or reworking a page, a panel, a card, a dialog or a step of a wizard; a screen is not done until its shots pass [the check](#the-check) at the end.

The rules are taken from the screens that work, not invented: what the stats page and the project page do, and what the user turned down on the others (2026-10-24). "Make it look good" says nothing to a session; each rule below can be checked on a screenshot.

## The bar

- **`/stats`** — a column of cards, each with a title that reads as a title, tiles with one big number and a muted label, a filter rail at the left, every chart with its legend, folded sections that say in one line what is inside.
- **The project page** (`/p/<id>`, a task picked) — the chain, the drawer at the right with facts in small boxes (uppercase label, value), one primary button, the problem in a red band with its action next to it.
- **The home page** — a grid of project cards of one height, the launch chart in a card.

Turned down, not to be copied:

- **`/status`** before BTN-357 — a list at the left and one item at the right with a single word "connected", the rest of a 2560 px screen empty, a table whose second column says "just now" in every row, the same fact as a dot, a word and a "Connection: connected" line.
- **The settings "Access" tab** before BTN-355 — environment variable names as labels, a "set" chip, a field and two buttons per row.
- **The project wizard and the first run** before BTN-344/BTN-346 — a form in a box glued to the left edge, steps as numbered grey captions between lines.

## Tokens

Only these values. A colour, size, radius or duration that is not here is either one of these or a new token added here and to `:root` of `web/src/styles.css`, in both themes for a colour.

**Colour** — the variables in `:root` of `web/src/styles.css`; never a hex or `rgb()` in a page's CSS.

| Role | Variables |
| --- | --- |
| Page, card, inner box, line | `--bg`, `--surface`, `--surface-muted`, `--border` |
| Text, quiet text, links and focus | `--fg`, `--fg-muted`, `--accent` |
| A state | `--lamp-done` (fine), `--lamp-working`, `--lamp-waiting` (attention), `--lamp-error` (error or limit), `--lamp-idle`, `--lamp-fix` |
| A project or a series in a chart | `--series-1`…`--series-8`, `--series-other` |
| A neutral share (models, entry points) | `--tone-1`…`--tone-6` |
| A band | `--warn-bg`/`--warn-fg`, `--error-bg`/`--error-fg` |
| The shadow of a menu or a tip over the page, of a dialog, of a side drawer | `--shadow-popover`, `--shadow-dialog`, `--shadow-drawer` |
| Text or a knob on a fill that keeps its depth in both themes: on a deep one (accent, red), on a bright one (amber) | `--on-fill`, `--on-bright` |
| The media viewer, dark in both themes | `--viewer-bg`, `--viewer-fg`, `--viewer-muted`, `--viewer-link`, `--viewer-control`, `--viewer-glass` |

Red is only an error or a limit; amber is a warning or a wait for the user; blue is work going on or a neutral note; green is fine. A bright colour is a small mark — a dot, a bar, a 3 px stripe, a chart. A surface larger than a chip that takes a series or lamp colour is mixed down: `color-mix(in srgb, var(--series-1) 18%, var(--surface))`.

**Type** — a size is a `--text-<px>` variable (`--text-11`, `-12`, `-13`, `-14`, `-15`, `-16`, `-22`, `-24`), `em` or `inherit`; 15 px is the body (`body`):

| Size | Weight | What |
| --- | --- | --- |
| `--text-22` | 600 | the page title (`.page__title`) |
| `--text-24` | 600, tabular | the big number of a tile |
| `--text-16` | 600 | a card's title |
| `--text-14` | 400 / 600 | controls, a row's label, the value of a fact |
| `--text-13` | 400 | secondary text, a tile's label, a hint under a field, error and warning bands |
| `--text-12` | 400 / 600 | chips and tags, table heads |
| `--text-11` | 400, uppercase, `letter-spacing: 0.04em` | a section label inside a card, a fact's label |

Weights are 400 and 600 only (Chromium draws 500 as 600 in Segoe UI, so a 500 became 600). Mono (`--mono`) is only task keys, code, paths and the log.

**Space** — `--space-2`, `-4`, `-6`, `-8`, `-12`, `-16`, `-24` (the pixels they name). Inside a card 12–16 px; between cards 12–16 px; between the page title and the content 16 px (`.page`).

**Radius** — `--radius` (10 px) for a card, a panel, a band; `--radius-control` (8 px) for a control or a box inside a card; `--radius-pill` (999 px) for a pill and a thin bar; `--radius-small` (4 px) for a mark inside a control — inline code, a key, a swatch, a focus ring; 50 % for a dot. A box set inside a card's 1 px border takes `--radius-inner`, a ring drawn 1 px around one `--radius-outer`.

**The test** — `web/src/design.test.ts` reads every `web/src/**/*.css` through `cssViolations` (`web/src/ui/cssRules.ts`) and holds four rules: no hex or `rgb()`/`hsl()`/… colour outside `:root`; `font-size` (and the size in a `font` shorthand) only a `--text-*`, `em` or `inherit`; `font-weight` only 400 or 600; `border-radius` only a `--radius*` token, 50 %, 999px, `inherit` or 0. The violations older than the rules are counted per file in `web/src/design-baseline.json`, and a count may only go down: the test fails listing the lines when a file has more than its count, and asks for `npm run design-baseline` (it rewrites the file) when it has fewer. A new stylesheet starts at zero; a value off the scale is a new token here and in `:root`, not a raise of the baseline. Since BTN-358 the baseline holds only the one-off decorations, drawn to their own scale on purpose: the basement's tapes and sign (`layout/basement.css`) and the stats stamp (`.stats-stamp` in `stats/overview.css`, its 6 px corner, 20 px word and 10 px caption).

**Motion** — one duration per kind (BTN-112), the `--motion-*` tokens: `fold` 0.12 s ease-out (opening and closing a block in the page flow, including notices), `fast` 0.15 s (hover, small state changes, a caret or chevron turning, a reorder settling), `appear` 0.2 s ease-out (a page, dialog or panel), `mark` 1.6 s ease-out (`block-glow` on a new or landed block), `skeleton` 1.4 s linear (`shimmer`), `blink` 1.2 s, `spin` 0.8 s. Folds and their carets have no transition with reduced motion. A new animation takes a token and an existing keyframe rather than a copy. Only the chain's beat choreography (`--beat-*` in `chain.css`) and one-off decorations (the basement, the stats stamp, the scanner) keep their own timings.

## Blocks

Take the component that exists — the shared ones are in `web/src/ui/blocks.tsx`, styled by `web/src/ui/blocks.css` (`ui-*` classes) — rather than inventing a variant. A page adds a class of its own for what is its own (`className`), it does not redraw the block.

- **Page head** — `PageHead`: the 22 px title, its help tip, the page's actions at the right (`/stats`, the home page).
- **Card** — `Card` (`CardHead` alone where the card's box is the page's own, as `Section` of `/stats`): `--surface`, 1 px `--border`, `--radius`, padding 14–16 px, a column with 12 px gaps. Its title is 16 px 600 on a line of its own, actions at the right of the same line. Every group of content on a page is a card; a group is never only a caption between two lines.
- **Section label** — `SectionLabel`: 11 px uppercase muted, to split one card into parts. Never the title of a card and never a whole page's structure.
- **Tile** — `Tile` in a `TileGrid`: one number and what it is: label 13 px muted, value 24 px 600 tabular, a note 13 px muted; the grid is `repeat(auto-fit, minmax(170px, 1fr))`.
- **Fact** — `Fact` in a `FactList`: a small box on `--surface-muted`, `--radius-control`: an 11 px uppercase label over a 14 px value, `tone` `warn` or `danger` for a value that needs the eye, `wide` across the list. For two to six facts about one thing; a definition list in plain text is not used. A fact holds its figure alone, with no line under it: the details (when a session started, how long its cache lives) are a tip on the figure (`TipValue`), so a row of facts stays one height at any width. Two short facts may share a row with the label and the value on one line (`panel__inline`: Model over two columns, its name cut with an ellipsis, Tokens over one).
- **Row** — a setting: the label at the left, the control at the right, the hint in a tip (`Row` in `web/src/pages/settingsParts.tsx`).
- **Provider choice** — `ProviderChoices`: an inner block on `--surface-muted`, `--border`, `--radius-control`, selected with an accent border, an 8% accent mix into `--surface`, an accent title and a filled corner check. The corner is a radio; the block selects too, except its controls. Unselected fields stay active. The Provider caption holds the help and inheritance; fields stack on narrow screens.
- **Plaques** (BTN-94) — a status is a `.chip`, a coloured fill (`running`, a question, a skipped task, a closed one in the stats table); a label is a `.tag`, a neutral outline (a model, "blocks"/"waits for it", the ghost's caption, "Backlog · N", tracker labels in the card). **Centring text in a plaque is a repeated trap:** Segoe UI puts lowercase text about 2 px below the middle of its line box (ascent 13 of 16 px at 12 px), so a pill with lowercase text ("max", "pro") looks low however `align-items` is set. `.tag` trims its box to the x-height (`text-box: trim-both ex alphabetic`, padding `calc((18px - 1ex) / 2)`); a new plaque with lowercase text does the same, one with capitals trims to `cap`. Check it on a screenshot zoomed 4–5×, at 1× it is not seen.
- **Band** — `Band` (`tone` `note`, `warn` or `error`) across the card or the page, with its action at the right (the "What sessions get: 1 problem → Open" band of the project page). A band under the header (`Banner`) is the same: one line per problem, the text at the left, the action in `banner__actions` at the right edge, kept at the right when it wraps under the text on a narrow screen; an error is the red band itself (`tone="error"`), never a red box inside a band of another colour, nor a title line above it (BTN-601).
- **Folded warnings** — `FoldBand`: one warning band with a count and a short summary, a keyboard toggle, and an action that stays available while folded. Errors stay outside it, above the warnings.
- **Disclosure** — `Fold` (`ui/Fold.tsx`, `ui/fold.css`): a button with `aria-expanded` and `aria-controls`, the shared `ChevronIcon` turning through `fast`, and a body whose grid rows change from 0fr to 1fr with opacity through `fold`. Pass a function as children for expensive content: it is called only while mounted. Content mounts on opening, stays through the exit and unmounts after the body's transitions finish; reversing a transition cancels its pending removal. Saved/conditional states stay with the caller through `open`/`onOpenChange` or `defaultOpen`. Closing restores focus from hidden content and, if the header was above the scroll area, brings it back into view. `FoldToggle`/`FoldBody` share the same mechanism where the header is separate or the body lives in a table cell. A text `preview` retains the clipped first six lines (`--fold-preview` overrides the height for Markdown). `FoldPresence` retains a disappearing notice until its exit ends; `FoldList` does the same for individual keyed notifications without reordering the remaining ones. Native `<details>` is forbidden by `design.test.ts`; menus, popovers and the chain's card choreography keep their own motion.
- **Empty state** — `EmptyState`: what is missing, and the button that adds it (the home page without projects).
- **Command** (BTN-432) — `CommandBlock`: a command the page asks a person to run, as a code block of its own — `--bg` with a border, mono 13 px, a long line wrapped inside — with a copy icon in its top right corner that turns into a check for 2 s; without the clipboard (plain HTTP from another host) only selectable text. Every such command takes it (the folder trust of the project wizard, the marketplace offer of Tools); a command is never mono text inline in a band.
- **Download** (BTN-600) — `CliProgress` (`web/src/layout/CliCopies.tsx`): one line, the kind of download ("Downloading CLI copy") at the left and, right of it, a meter in a box of its own — `--surface`, 1 px `--border`, `--radius-control` — holding three parts: the name of what is downloading (13 px: "Codex", "Claude Code"), a full-height divider, a 6 px pill bar (`--accent` on `--surface-muted`, 240 px, shrinking on a narrow screen), a short divider and "A of B MB" in 12 px muted tabular figures; before the size is known the box says "Preparing download…", at the full size "Verifying and unpacking…". On a narrow screen the box wraps under the words. The box, not the band, carries the colour, so the band stays one line high; a new download — a CLI, an update — takes the same look, and its status stays "downloading" until every package of it is in place, so the band does not fold and come back between them.
- **Dividers in a segmented box** (BTN-600) — a box of several parts in a row (the account block of the header, the download meter) splits them with 1 px `--border` lines of two heights: a full-height line between different things (the account and its limits, the name and its progress), a short 16 px line, centred, between parts of one thing (one limit window and the next, the bar and its megabytes). The short line is a `linear-gradient` background at the part's left edge (`.hblock__seg.limit + .hblock__seg.limit`, `.cli-copy__bytes`), so it takes no border and no pseudo-element.
- **Wizard** (BTN-346) — `WizardFrame` and `WizardFoot` (`web/src/pages/WizardFrame.tsx`): a centred 760 px column, its head, the steps as dots on a line (done filled with a check and a summary under the label, the current a ring, the rest empty, each a link), the step in one card, and its foot — "← Back" a quiet link, the primary "Next: <step> →" at the right, "Skip for now" on an optional step; Enter is next. A dot is `StepDot`, shared with the project wizard (BTN-344), whose steps are settings cards all shown at once, each led by a dot of its check: empty, a ring for the first unfilled, green with a check when passed, red when failed with the reason under the field. `/setup` and `/projects/add` use it; a new wizard takes it rather than a list of steps of its own. A choice inside it is a card that rises on hover, the picked one with the accent's edge and a check in its corner (`ChosenMark`).
- **Buttons** — `.button`, `.button--primary` (one per card or dialog: the thing to do next), `.button--small` (a button inside a list row, as Restore and Done on a chain row, so it does not make the row taller; it is declared after `.button` in `controls.css`, which it would lose to otherwise), `.button--danger`. A rare or destructive action goes into a ⋯ menu, not next to the main one: `MoreMenu` (`web/src/ui/MoreMenu.tsx`, the account card's "Remove"), an item that cannot be done greyed with why under it; a menu of its own builds on `usePopoverMenu`. A greyed button that has a reason is `aria-disabled`, not `disabled`, so the reason is reachable from the keyboard.
- **Tip** — an explanation or a quiet detail is a tip, not a line of text: `Tipped` (`web/src/ui/Tipped.tsx`, over `useTip`) opens once the pointer has rested on it `OPEN_DELAY_MS` (700 ms), so a pass of the mouse over a row opens nothing, and at once on focus or a press; a tip open or closed within `WARM_MS` (300 ms) makes the next pointed one open at once — that state is the page's, shared by every tip (EKR-28, the pattern of Windows, macOS and VS Code). The native `title` is too slow and goes unnoticed. The "?" of a setting (`HelpTip`) is a toggletip: only a press opens and closes it, pointing and focus do nothing. A tip of text takes no pointer (`pointer-events: none` on `.tip`, `.help__tip`, `.panel__split`, BTN-208): its popover sits inside the anchor in the DOM, so a pointer over it would keep the anchor hovered and the tip open; it closes `CLOSE_DELAY_MS` after the pointer leaves the anchor, and its text cannot be selected. Only a tip with buttons takes the pointer — the related tasks of `Links` (`.links__tip`).
- **Modal** (BTN-114) — the page behind every modal `<dialog>` — the task card, the session window, the transcript and the chat, the media viewer — is dimmed and blurred alike, by `--scrim` and `--scrim-blur`; only the media viewer keeps its own, darker dimming. A new modal takes both tokens. A dialog is a card: title, content, the primary button at the bottom right.
- **Targets** are at least 24 px (WCAG 2.5.8) and the header's 44 px up to 760 px, grown with padding or an invisible `::after`, never with the text.

- **Action with help** — `ButtonWithTip` (`web/src/ui/ButtonWithTip.tsx`) joins an existing action button to a separate `?` button at its right edge. The main action keeps its handler; help uses `useTip` like `HelpTip`: only a press opens or closes it, Escape and a press outside close it, pointing and focus do nothing. Both buttons remain in the Tab order.

## Layout

- **A page** is the title row — the 22 px title, its help tip, the page's actions at the right — and the content under it (`.page`). The column is the whole width (`--column`).
- **No half-empty screen.** Content that is narrow by nature — a form, a list of settings, a wizard, a short status — is centred with a `max-width`, or the free side holds content of its own. A block glued to the left with the right half of the screen empty is a defect; look at it at 1600 px and wider, not only at 1280.
- **List and detail** (a list at the left, the picked item at the right) only when an item's detail is large: a transcript, a long form, a task. When each item has two to six facts, show all items at once as cards in a grid.
- **Cards in a row are one height** and their buttons stand on one line at the bottom.
- **Narrow** is 760 px and below (`useNarrow`): one column, the settings groups in a drawer, nothing cut. Wide is 1200 px and up (`useWide`).

## Content

- **One fact once.** A state is a dot and a word in one place; it is not repeated as a heading, a line and a table cell.
- **A problem has its fix next to it**: the button that fixes it, or the link to the place where it is fixed, named as the page labels that place.
- **Words, not internals.** A person reads labels; a variable name, a config path, a CLI flag, `/usage` or a raw id go into a tip or nowhere. A project is named by its label (`ProjectLabel`), never by its id.
- **A table** only when its columns differ from row to row. A column that says the same thing in every row becomes one line above the table ("all read within a minute"), and only the rows that differ are marked.
- **An empty state** says what is missing and has the button that adds it.
- **Long text goes into a tip**; a card holds what is read at a glance. Run labels use `RunLabelTag` in the chain and task card: the provider keeps its tracker spelling, the model hides everything through its last `/`, and `title` holds the full tracker label. Only the model takes an ellipsis when space runs out; the provider stays whole. On a chain row the cap of 32 ch is on the run label, not on the row's right side, so the chips, the session meter, a button and the counters stay one line. The card's labels and role captions use the full property width.
- **Order by what the person looks for first**: the state and the problem at the top, details under them, settings and rare actions last.

## The check

Before the merge, for every screen the task built or changed:

1. Shoot it with `npm run shot` (`docs/web.md`) in the dark theme at 1600×1000 and at 390×844, and each of its states the fake data can show (empty, an error, a long name); then once in the light theme, which only must not break. What the screen hides until a click — a `<details>`, a tab, a menu, a dialog — is opened with `--click` and shot open: a control nobody shot is a control nobody checked (BTN-449 merged unstyled text fields under a closed `<details>`).
2. Open each picture and answer every line; a "no" is fixed before the merge, not noted:
   - Is any part of the screen empty while the content is squeezed or glued to one side?
   - Does every title read as a title, larger and bolder than the text under it, and every group sit in a card?
   - Is any fact shown twice, or any table column the same in every row?
   - Is there a variable name, a path, a flag, an id or a code in the text a person reads?
   - Does every problem on the screen have its action next to it, and every empty state its button?
   - Is there more than one primary button in a card or a dialog?
   - Is every colour, size, weight, radius and gap one of the tokens above?
   - Does it look like it belongs next to `/stats` and the project page?
3. Write each question above with its answer into `.temp/design-check.md`, after the shots, and name the shots and the answers in the closing comment of the task.

## As a standard

A project makes this document binding through its setting "Standards" (Project settings → Sessions; `docs/sessions.md`, "Project standards"). The button "Add "Interface"" adds it with the masks of the interface files (`**/*.tsx`, `**/*.jsx`, `**/*.vue`, `**/*.svelte`, `**/*.css`, `**/*.scss`, `**/*.html`, except `**/*.test.*`) and "Shots and answers before the merge" on. Then a session gets the document with its first read of such a file, is refused an edit of one before it, and its merge of a branch that changed one waits until `.temp/shot/` has pictures newer than the last change and `.temp/design-check.md`, newer than the pictures, holds every question of "The check" with an answer. The questions are read from the list items of "The check" that end with "?": a new rule there is a new question, and a line that is no question must not end with one.
