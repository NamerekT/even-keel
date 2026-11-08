# Page: hotkeys

Keyboard actions of the page and the window that changes them (BTN-880).

## Actions

The actions are the list `HOTKEY_ACTIONS` with their defaults `DEFAULT_HOTKEYS` in `src/hotkeys.ts`, shared by the server and the page. A new action is a name there, a `useHotkey(action, run)` call in the component that owns it, and its name and tip in `web/src/i18n/hotkeys-*.ts`.

| Action | Default | What it does |
| --- | --- | --- |
| `chainRun` | `Mod+Enter` | On a project page, the header button: `chain/start`, or `chain/resume` on a pause (`chainRunControl`, `web/src/hotkeys/actions.ts`). A running chain is left alone: never stopped or restarted. Other pages leave the key free. |
| `chatTask` | `Mod+B` | In the chat window of a session with a task, opens and closes the task panel at the left (BTN-891, `docs/web/session-panel.md`); on a narrow screen opens the full card over the chat. Works while typing in the reply field. |
| — | double click | A double click on a chain row opens its card (`onCard`), unless it lands on the row's own button, field or link; a mouse down with `detail > 1` keeps the title from being selected. Not changeable. |

`useHotkey` listens to `keydown` on `window` while its component is mounted and skips repeats and every key `keysBlocked` holds back (`web/src/hotkeys/combo.ts`): IME composing, focus in `input`, `textarea`, `select` or `contenteditable`, and any open `dialog` — the task card, the hotkeys window itself. A dialog's own action is not a `useHotkey`: `useDialogHotkey(action, run)` returns a handler for the dialog's `onKeyDown`, which runs inside it, its fields included, and is held back only by IME composing. Such an action is listed in `TYPING_ACTIONS` (`src/hotkeys.ts`) and never takes Enter, which the chat field keeps for sending and new lines.

## Combinations

A combination is text: modifiers in the order `Mod, Ctrl, Meta, Alt, Shift` and a key by `KeyboardEvent.code` (`KeyK` → `K`, `Digit1` → `1`), joined by `+`. `Mod` is Cmd on a Mac and Ctrl elsewhere, so one default fits both; a Mac's Ctrl stays `Ctrl`, Windows' Win key is `Meta`. The system comes from `navigator.userAgentData.platform`, else `navigator.platform` (`isMac`). `formatCombo` shows `⌘ Enter` with the symbols ⌃⌥⇧⌘ on a Mac and `Ctrl+Enter` (Win for `Meta`) elsewhere: nobody sees the word `Mod`.

## The window

The gear menu of the header has "Hotkeys" after "Tools", and the narrow menu the same row (`HotkeysRow`, `useHotkeysWindow` in `web/src/layout/Status.tsx`). The window (`web/src/hotkeys/HotkeysDialog.tsx`) has a row per action: its name with a tip, the combination, "Change" and, when the browser changed it, "Default"; the fixed double-click row is greyed with "fixed"; at the bottom "Reset all" and "Close".

"Change" records the next key down in the dialog; Esc cancels. `refusalOf` turns a combination down with a line under the row, from i18n: one held by another action (named), a bare key without `Mod`, `Ctrl`, `Meta` or `Alt` other than F1–F12, the ones a browser keeps (`Mod` with W, T, N, L, Tab or Q, and Ctrl+Tab), and Enter with any modifiers for an action of `TYPING_ACTIONS`. The server checks only the shape (`hotkeyBindingsOf`).

## Storage by browser

The layout belongs to a browser profile, not to Even Keel. On its first visit the page makes a random 32-hex id and keeps it in `localStorage` under `even-keel.browser` (`browserId`, `web/src/hotkeys/useHotkeys.ts`); without storage it lives as long as the tab. Each change sends the browser's whole own layout — only what differs from the defaults — as `hotkeys/save` (`browser`, `bindings`); an empty layout deletes the row. The service keeps every browser's layout in memory, writes it behind into `browser_hotkeys` (`docs/storage.md`) and puts it into the state as `hotkeys` by browser id, so another tab of the same browser picks a change up at once.

Accepted limits: `localStorage` is per page address, so `localhost:4747`, `127.0.0.1:4747` and the Tailscale address are three browsers; clearing the site's data or a private window is a new browser with the defaults. Abandoned rows are tiny and never cleaned.
