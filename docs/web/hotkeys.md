# Page: hotkeys

Keyboard actions of the page and the window that changes them (BTN-880).

## Actions

The actions are the list `HOTKEY_ACTIONS` with their defaults `DEFAULT_HOTKEYS` in `src/hotkeys.ts`, shared by the server and the page. A new action is a name there, a `useHotkey(action, run)` call in the component that owns it, and its name and tip in `web/src/i18n/hotkeys-*.ts`.

| Action | Default | What it does |
| --- | --- | --- |
| `chainRun` | `Mod+Enter` | On a project page, the header button: `chain/start`, or `chain/resume` on a pause (`chainRunControl`, `web/src/hotkeys/actions.ts`). A running chain is left alone: never stopped or restarted. Other pages leave the key free. |
| `chatTask` | `Mod+B` | In the chat window of a session with a task, opens and closes the task panel at the left (BTN-891, `docs/web/session-panel/panel.md`, "The chat's task panel"); on a narrow screen opens the full card over the chat. Works while typing in the reply field. |
| — | double click | A double click on a chain row opens its card (`onCard`), unless it lands on the row's own button, field or link; a mouse down with `detail > 1` keeps the title from being selected. Not changeable. |

`useHotkey` listens to `keydown` on `window` while its component is mounted and skips repeats and every key `keysBlocked` holds back (`web/src/hotkeys/combo.ts`): IME composing, focus in `input`, `textarea`, `select` or `contenteditable`, and any open `dialog` — the task card, the hotkeys window itself. A dialog's own action is not a `useHotkey`: `useDialogHotkey(action, run)` returns a handler for the dialog's `onKeyDown`, which runs inside it, its fields included, and is held back only by IME composing. Such an action is listed in `TYPING_ACTIONS` (`src/hotkeys.ts`) and never takes Enter, which the chat field keeps for sending and new lines.

## Keys of a form with a draft

Ctrl+S, Ctrl+Z and Ctrl+Shift+Z (Ctrl+Y too off a Mac; Cmd on a Mac) work in the forms whose edits are a draft under a save bar (BTN-1064): the shared settings (`SharedSettings`), a project's panel (`SettingsPanel`), a tracker profile's rules (`ProfileRules`) and a source's window (`SourceDialog`, a project's main tracker or a feed). They are fixed: `DRAFT_COMBOS` (`web/src/hotkeys/combo.ts`), refused to an action by `refusalOf` with the name of the key that holds them, and shown greyed with "fixed" in the window. The one-off small dialogs — keys, a profile, adding an account, the badge's secret — are no draft and do not take them.

A form calls `useDraftKeys(ref, { canSave, save, parts })` (`web/src/hotkeys/draftKeys.ts`); one `keydown` listener on `window` serves every form mounted, and a page without one leaves the keys to the browser. The press goes to `draftTargetOf`: under an open dialog the form inside it — a tracker window over the panel saves the window — else the latest form outside every dialog; under a dialog of another kind, none. These keys are a deliberate exception to `keysBlocked`: they work in a field and inside the source window.

- **Ctrl+S** does what the save button does: `requestSubmit()` of the `<form>`, so `onSubmitCapture` and the tables' check run, or the window's own save handler. With nothing changed or no save possible (being sent, a field wrong) it does nothing, but it still takes the key (`preventDefault`), so the browser's "Save page" never opens over a form. Repeats and IME composing are skipped (`draftKeyOf`).
- **Ctrl+Z / Ctrl+Shift+Z** in a text field (`input` of a text type, `textarea`, `contenteditable`) are the browser's own undo of the typing. Elsewhere — a switch, a select, a check box, the page — they step the draft's history (below) and take the key only when a step was made.

**The history** (`web/src/pages/settingsHistory.ts`) is kept per draft scope by `useDraft` (`web/src/pages/settingsStore.ts`): every edit of every form goes through `writeDraft`, so the forms need nothing of their own. A step is the fields an edit changed with their values before and after (`historyAfter`, the difference of `edit`); a run of edits of the same fields joins one step (typing is one step, not a letter each), and one that comes back to where its step started removes it; an edit of several keys at once (`editAll`, the model reset) is one step. A new edit drops what was undone; a change of `base` — a save, the file changed under the draft, a revert to a moved file — starts the history over. Nothing reaches the service before a save, so a stray press is safe and Ctrl+Shift+Z brings it back. The history lives as long as the page, like the drafts.

Ctrl+Z steps the latest step of the open section only: a form passes `parts`, each a draft scope and the keys of its open tab (`keysOf(open)`, a source window's tab's `undo`); the other sections' steps stay. A form over two drafts (a profile's rules and moves) takes the latest of both by the step's `seq`, which an undo and a redo renew, so the step undone last is made again first. "Revert all" stays a button only (the save bar's arrow, "Revert changes" in the window): a destructive action gets no key, and Esc closes dialogs.

## Combinations

A combination is text: modifiers in the order `Mod, Ctrl, Meta, Alt, Shift` and a key by `KeyboardEvent.code` (`KeyK` → `K`, `Digit1` → `1`), joined by `+`. `Mod` is Cmd on a Mac and Ctrl elsewhere, so one default fits both; a Mac's Ctrl stays `Ctrl`, Windows' Win key is `Meta`. The system comes from `navigator.userAgentData.platform`, else `navigator.platform` (`isMac`). `formatCombo` shows `⌘ Enter` with the symbols ⌃⌥⇧⌘ on a Mac and `Ctrl+Enter` (Win for `Meta`) elsewhere: nobody sees the word `Mod`.

## The window

The gear menu of the header has "Hotkeys" after "Tools" (`HotkeysRow`, `useHotkeysWindow` in `web/src/layout/Status.tsx`); the narrow menu has no such row, a phone having no keyboard (BTN-1162). The window (`web/src/hotkeys/HotkeysDialog.tsx`) has a row per action: its name with a tip, the combination, "Change" and, when the browser changed it, "Default"; the forms' Save, Undo and Redo rows (with Ctrl+Y beside Ctrl+Shift+Z off a Mac) and the double-click row are greyed with "fixed"; at the bottom "Reset all" and "Close".

"Change" records the next key down in the dialog; Esc cancels. `refusalOf` turns a combination down with a line under the row, from i18n: one held by another action or by a form's fixed key (named), a bare key without `Mod`, `Ctrl`, `Meta` or `Alt` other than F1–F12, the ones a browser keeps (`Mod` with W, T, N, L, Tab or Q, and Ctrl+Tab), and Enter with any modifiers for an action of `TYPING_ACTIONS`. The server checks only the shape (`hotkeyBindingsOf`).

## Storage by browser

The layout belongs to a browser profile, not to Even Keel. On its first visit the page makes a random 32-hex id and keeps it in `localStorage` under `even-keel.browser` (`browserId`, `web/src/hotkeys/useHotkeys.ts`); without storage it lives as long as the tab. Each change sends the browser's whole own layout — only what differs from the defaults — as `hotkeys/save` (`browser`, `bindings`); an empty layout deletes the row. The service keeps every browser's layout in memory, writes it behind into `browser_hotkeys` (`docs/storage.md`) and puts it into the state as `hotkeys` by browser id, so another tab of the same browser picks a change up at once.

Accepted limits: `localStorage` is per page address, so `localhost:4747`, `127.0.0.1:4747` and the Tailscale address are three browsers; clearing the site's data or a private window is a new browser with the defaults. Abandoned rows are tiny and never cleaned.
