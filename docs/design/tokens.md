# Design: tokens and guards

The values a stylesheet may use, and the tests that hold the page to them. The index and the check of a screen are [`docs/design.md`](../design.md).

## Tokens

Only these values. A colour, size, radius or duration that is not here is either one of these or a new token added here and to `:root` of `web/src/styles.css`, in both themes for a colour. The dark value goes into the one `:root[data-theme='dark']` block, never into a `prefers-color-scheme` query: the page picks its theme itself, by the system or by the user's choice (`docs/web/interface.md`, "Theme"). A component's own dark colour stands under `:root[data-theme='dark'] .<block>`, where the last part is the component's class (`.basement` in `layout/basement.css`). The guard takes a literal colour only inside `:root` and `:root[data-theme=…]` ([Guards](#guards)).

**A component's own variable** — a size, a gap or a delay that only one component uses — is allowed and is declared on that component's selector in its own stylesheet: `--toast-gap` and `--toast-shade-*` on `.toasts` (`ui/toast.css`), `--rows` on `textarea.settings__text` (`settings.css`), `--fold-preview` overridden by a page (`.share__body`), the chain's `--beat-*` (`chain.css`). A measure the whole layout shares stays in `:root` beside the tokens: `--column` (the page's column), `--gutter`, `--header-height`, `--pane-scrollbar` (a pane's scrollbar). Such a variable is never a new colour, type size, weight or radius — those are tokens of the tables below — and it is built from `--space-*` where one fits.

### Colour

The variables in `:root` of `web/src/styles.css`; never a hex or `rgb()` in a page's CSS.

| Role | Variables |
| --- | --- |
| Page, card, inner box, line | `--bg`, `--surface`, `--surface-muted`, `--border` |
| Text, quiet text, links and focus | `--fg`, `--fg-muted`, `--accent` |
| A state | `--lamp-done` (fine), `--lamp-working`, `--lamp-waiting` (attention), `--lamp-error` (error or limit), `--lamp-idle`, `--lamp-fix` |
| The logo's keel (the loader's boat), as in `favicon.svg` | `--keel` |
| A project or a series in a chart | `--series-1`…`--series-8`, `--series-other` |
| Who bills an account's connection: the stripe of its group (Nested group in [`blocks.md`](blocks.md)), aliases of series hues so both themes follow | `--owner-anthropic`, `--owner-openai`, `--owner-openrouter`, `--owner-zen`, `--owner-github`, `--owner-aws`, `--owner-google`, `--owner-microsoft` |
| A neutral share (models, entry points) | `--tone-1`…`--tone-6` |
| A band | `--warn-bg`/`--warn-fg`, `--error-bg`/`--error-fg` |
| The shadow of a menu or a tip over the page, of a dialog, of a side drawer | `--shadow-popover`, `--shadow-dialog`, `--shadow-drawer` |
| The dimming and the blur behind every modal (Modal in [`blocks.md`](blocks.md)) | `--scrim`, `--scrim-blur` |
| Text or a knob on a fill that keeps its depth in both themes: on a deep one (accent, red), on a bright one (amber) | `--on-fill`, `--on-bright` |
| The media viewer, dark in both themes | `--viewer-bg`, `--viewer-fg`, `--viewer-muted`, `--viewer-link`, `--viewer-control`, `--viewer-glass` |
| A QR code, black on white in both themes | `--qr-bg`, `--qr-fg` |

Red is only an error or a limit; amber is a warning or a wait for the user; blue is work going on or a neutral note; green is fine. A bright colour is a small mark — a dot, a bar, a 3 px stripe, a chart. A surface larger than a chip that takes a series or lamp colour is mixed down: `color-mix(in srgb, var(--series-1) 18%, var(--surface))`.

### Type

A size is a `--text-<px>` variable, `em` or `inherit`:

| Size | Weight | What |
| --- | --- | --- |
| `--text-24` | 600, tabular | the big number of a tile |
| `--text-22` | 600 | the page title (`.page__title`) |
| `--text-16` | 600 | a card's title |
| `--text-15` | 400 | the body text (`body`) |
| `--text-14` | 400 / 600 | controls, a row's label, the value of a fact |
| `--text-13` | 400 | secondary text, a tile's label, error and warning bands |
| `--text-12` | 400 / 600 | chips and tags, table heads |
| `--text-11` | 400, uppercase, `letter-spacing: 0.04em` | a section label inside a card, a fact's label |

Weights are 400 and 600 only (Chromium draws 500 as 600 in Segoe UI, so a 500 became 600). Mono (`--mono`) is only task keys, code, paths and the log.

### Space

`--space-2`, `-4`, `-6`, `-8`, `-12`, `-16`, `-24` (the pixels they name). Inside a card 12–16 px; between cards 12–16 px, 24 px between cards that hold nested groups; between the page title and the content 16 px (`.page`).

### Radius

| Token | Value | For |
| --- | --- | --- |
| `--radius` | 10 px | a card, a panel, a band |
| `--radius-control` | 8 px | a control or a box inside a card |
| `--radius-pill` | 999 px | a pill and a thin bar |
| `--radius-small` | 4 px | a mark inside a control: inline code, a key, a swatch, a focus ring |
| `--radius-inner` | `--radius` − 1 px | a box set inside a card's 1 px border |
| `--radius-outer` | `--radius` + 1 px | a ring drawn 1 px outside a card |
| `--radius-halo` | `--radius` + 4 px | the outer edge of a 4 px halo around a card (the running group's edge, `chain.css`) |
| `--radius-strip` | 11 px | the bottom of a field's strip (Field strip in [`fields.md`](fields.md)) |
| 50 % | — | a dot |

### Motion

One duration per kind (BTN-112), the `--motion-*` tokens:

| Token | Duration | What |
| --- | --- | --- |
| `--motion-fold` | 0.12 s ease-out | opening and closing a block in the page flow, notices included |
| `--motion-fast` | 0.15 s | hover, small state changes, a caret or chevron turning, a reorder settling |
| `--motion-appear` | 0.2 s ease-out | a page, a dialog or a panel showing up, and a dialog's height gliding to new content (`useHeightGlide`) |
| `--motion-step` | 0.25 s | one step of the chain's motion: a take's frame, a leave, a row moving into the running group "Under way" or out of it, and the gap from one beat to the next (`STEP_MS` in `web/src/ui/motion.ts`, BTN-1613) |
| `--motion-mark` | 1.6 s ease-out | `block-glow` on a new or landed block |
| `--motion-skeleton` | 1.4 s linear | `shimmer` |
| `--motion-blink` | 1.2 s | a lamp blinking |
| `--motion-spin` | 0.8 s | a spinner turning |
| `--motion-sway` | 2.4 s | the loader's boat rocking; its sea at half of it |
| `--motion-tick` | 2 s | the minute hand of a delivering message's clock; its hour hand at twelve times it |

Folds and their carets have no transition with reduced motion. A new animation takes a token and an existing keyframe rather than a copy. Only the chain's beat choreography (`--beat-*` in `chain.css`) and one-off decorations (the basement, the stats stamp, the scanner) keep their own timings.

## Guards

`web/src/design.test.ts` holds the page to the rules of this document; each guard's rules are a module of `web/src/ui/` with its own unit test beside it (`cssRules.test.ts` tests `cssViolations` on samples, `design.test.ts` runs it over every stylesheet). The code read is `web/src` without tests and `live/fake*`.

**The baseline.** The violations older than a rule are counted per file in a `web/src/*-baseline.json`, and a count may only go down: a file with more than its count fails with the lines, a file with fewer asks for `npm run design-baseline`, which rewrites every baseline. A new file starts at zero. A task that clears an area lowers its counts; a value off the scale is a new token, never a raise of the baseline.

| Guard | What it counts | Rules | Baseline | Let through |
| --- | --- | --- | --- | --- |
| Tokens | in every `web/src/**/*.css`: a hex or `rgb()`/`hsl()`/… colour outside `:root`; a `font-size` (or the size in a `font` shorthand) other than a `--text-*`, `em` or `inherit`; a `font-weight` other than 400 or 600; a `border-radius` other than a `--radius*` token, 50 %, 999px, `inherit` or 0 | `cssRules.ts` (`cssViolations`) | `design-baseline.json` | since BTN-358 the baseline holds only the one-off decorations, drawn to their own scale on purpose: the basement's tapes and sign (`layout/basement.css`) and the stats stamp (`.stats-stamp` in `stats/overview.css`: its 6 px corner, 20 px word and 10 px caption) |
| Notes | every element of a note or a hint class (`*__note`, `*__hint`, `*-note`, `*-hint`) in the code; a line inside a tip (`panel__tip-note`, `mark-tip__hint`) is not counted | `noteRules.ts` (`noteSpots`) | `note-baseline.json` | `NOTE_EXCEPTIONS`: the short list of warning lines, each with its file, its element's own class and the reason |
| Glued facts | every `·` the page can show: in a string, a template or JSX text (the dictionaries `web/src/i18n/*` included) and in a stylesheet's `content`; comments and regular expressions are not read | `glueRules.ts` (`glueSpots`) | `glue-baseline.json` | `GLUE_EXCEPTIONS`: the dots that are marks, not separators, each with its reason — the basement's caution tape (`Basement.tsx`), the mark of an option not picked (`AskPanel.tsx`), the avatar of a nameless author (`CardJournal.tsx`) |
| Settings rows | each `Row` whose `control` is not a `Switch` | `rowRules.ts` | `row-baseline.json` | — |

The rules each guard holds are in [`blocks.md`](blocks.md) and [`fields.md`](fields.md) (Notes), in [`docs/design.md`](../design.md) (Glued facts: "Facts are never glued"; Settings rows: "Settings form") and above (Tokens).

**Refusals without a baseline** — `design.test.ts` fails at once on:

- a `type="checkbox"` outside a `.map(` over a list (Switch, [`fields.md`](fields.md));
- a native `<details>` (Disclosure, [`blocks.md`](blocks.md));
- a `×` glyph as a button's content (Close, [`blocks.md`](blocks.md));
- a `notice--error` inside an `add-package__body` (the error of a whole form, [`fields.md`](fields.md)).
