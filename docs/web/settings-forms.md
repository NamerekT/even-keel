# Page: the settings forms

What both settings pages share — the shared settings `/settings` (`docs/web/config.md`) and a project's panel (`docs/web/project-settings.md`): the layout of a form, inheritance marks, tables and selects, the draft and its save bar, token fields, table drafts, the provider choice. Parts both forms share are in `web/src/pages/settingsParts.tsx`, styles in `settings.css`; the general look is `docs/design.md`.

## Layout

BTN-337.

- A tab's fields are grouped into section cards (`Section`: a title, its "?", an optional `aside` at the right, `danger` for the red frame). The card's head is a band across its top (BTN-343); head, row name and value read as three levels.
- A short field is a `Row` — the name at the left, the control at the right, every control `--control-width` wide so the right edges line up. Under 340 px of form the control goes under its name; a switch takes only its own width. A text field, a table or a grid goes full width under its name.
- An on/off setting is a `Switch` (`role="switch"`, `SwitchField`), not a select or a checkbox; `brief` stays a select, its third value being "auto". Checkboxes and radios stay native inputs, drawn by the global rules in `web/src/styles.css`.

### Explanations

- A field's explanation is not a line under it but a "?" after its name (`FieldHead`, `HelpTip`), opened and closed by a press, not by pointing, with the same tip as the facts (`useTip`). It is pale until its row or heading is pointed at (`@media (hover: hover)`) and out of the Tab order, so Tab goes from field to field.
- Neither a tab nor a block gets an explanation line (BTN-324): Check and CI of `/settings` has a "?" by the tab's title, the profiles one by their heading, "Remove project" one by its name, and why a tracker or a feed's profile is locked (`trackerLocked`, `feedLocked`) is in the "?" of that field.
- Only an error, a warning or an empty state stays a line of text; a credential's row (an environment variable, "Credentials" in `docs/web/config.md`) keeps its short description beside the name.
- The settings apply at once, with no restart; that is said once, in the legend's line for the Settings tab (`t.help.signs.settings`), so the project panel's head has no "?" of its own.

## Inheritance

- One mark (`Inherit`, in the field's head or under a grid cell): the control always shows the value in force; an inherited one has a dashed "shared" chip, an own one an "own" chip with `InheritIcon` that goes back to the shared value (it names that value in its tip; unlike the "was … ↺" undo of an unsaved change).
- Editing an inherited field makes it own: a select or switch writes its value; a field kept by an `own*` flag (`ci.kinds`, `ci.waitMinutes`, `stats.checkpointTokens`, the three shares as one) is copied from the shared values first (`ownEdit`), so the fields are never greyed out.
- Edited back to the value it inherited, a field that started inherited inherits again, unchanged: a select, a switch, the provider and the protection go back to '' (`inheritedEdit`), an `own*` flag back to off (`ownEdited`, both in `settingsDraft.ts`); one that started own stays own.
- The protection compares by its rules, not its text (`sameProtection`), so groups switched back in another order are no change.

## Tables and selects

- A list field is an editable table (`web/src/pages/settingsTable.tsx`): `ListTable` for one column, `RowsTable` for several. A cell edits in place, long text wraps, the trash removes a row, the last row adds one once its cells are filled (Enter, or Ctrl+Enter in a multiline cell; Enter never submits the form).
- A column takes `suggest` (a `SuggestField`, free input still allowed, the values other rows took left out) or `options` (a select); the first column is the key and cannot repeat.
- The field values stay '\n' texts in the draft (`rowsOf`, `linesText`, `pairOf` in `settingsRows.ts`).
- A select across the page is `web/src/ui/Select.tsx`, not a native `<select>`: a combobox button with a listbox in a `popover` portalled to the button's closest `<dialog>`, else to `document.body`. The reasons: inside a `<label>` a press on an option would click the button again, and a modal dialog makes everything outside it inert, so a list in the body would show over the task card but take no clicks. Keys are in `selectKeys.ts`; Escape closes only the list.
- An option may carry an `icon` before its label and an `aside` after it (a muted `.select__note`, the unsaved dot), both shown in the button too.
- A long list takes `search` (the plugin pick of "Add a package", hundreds of plugins): a field atop the open list takes the typing, a printable key on the closed button opens it with that key. The list keeps the labels holding every word (`filterOf`; an option's `keywords` are read with its label, so the plugin pick, whose marketplace is its `aside`, BTN-1383, still finds a plugin by marketplace), those starting with the query first, then those with a word starting so. Arrows and Enter pick, Escape and Tab go back to the button.
- Every text field has `autoComplete="off"`: the browser's history of earlier values is noise in settings, names and searches. Only the git name and email of the setup keep `name`/`email`, and secret fields get theirs from `secretInput`.

## The draft

BTN-128, `web/src/pages/settingsDraft.ts` (pure, with tests); `settingsStore.ts` holds it.

- A `{ base, edit }` per field, kept at module level per scope (`project:<KEY>`, `shared`, `feed:<project>:<feed>`): closing the panel, Esc or leaving for Backlog/CI keep it, a reload drops it. A field typed back to its base is not changed.
- A changed field gets a stripe and an undo arrow in its head line, after the name and the chips, with "was: …" in the arrow's tip (`marksOf`). Nothing is added under the field, so a change moves nothing on the page: a grid cell's arrow goes in its column's head (`cellMark`), a field without a head puts it beside its buttons or in its section's heading.
- A field kept own by an `own*` flag has one arrow for the flag and its values (`Marks.note` with several keys): "was: shared" when it turned own, else its value. The checkpoint shares keep an arrow per share while they stay own, and one in the group's head once they turn own or shared.
- In the chain rules' tables the row reset shows only on a row whose value differs from the inherited one, not on every row of an own list.
- A changed tab gets a dot (`UnsavedDot`), and so does the outer Settings tab when any group is changed (`useSettingsDirty`).

### The save bar

- The sticky bar at the bottom (`SaveBar`) shows only when the open group is changed and holds its place while hidden, so its showing up neither moves the form nor covers the last field. In the side panel it sticks to the card's edge (`bottom` takes the panel's padding back, else the fields show through below it).
- Gray undo reverts the group, the green check saves only its fields, a save error goes under its field.
- A save holds the bar at "Saving…" with both buttons off from the press until the state brings the form's saved values (`useLanding` over the saved values, `SAVE_LANDING_MS` 15 s from the command's answer, BTN-1318). The draft settles only on that state, so without the hold the check came back on in between and a second press saved again. Past the limit the bar says the save went through but the page has not got the values yet, to reload it, and the buttons are on again. The project panel, the shared settings and a profile's rules (its rules and status moves together) hold the same way. ("Landing" here is the save's values reaching the page — not a merge's landing, `docs/chain.md`, nor a task's place in the chain.)

### Changes under a draft

- When the settings change under a draft (`rebase`), untouched fields take the new values silently. A field changed in both gets "the file now has: …" in the arrow's tip, and its undo goes to the stored value, while saving overwrites it on purpose.
- Each such change is kept into the stored draft (`settled`, BTN-598): a field saved and then changed back by the service — the CLI dialog's "Use installed CLI" after a save of "Checked" — starts from the saved value, so it takes the service's value instead of showing the old edit again.

## Table drafts

- `Draft.adding` keeps a table's unfinished row with its field (`PendingRow`: cells, encoded field value, validity and whether validation was shown). Text other than whitespace starts a row; an automatically chosen select does not. The field and tab become changed immediately.
- `sent` includes the row without requiring Add, while `edited` and `reverted` clear it with the field. A rejected save keeps the row and its validation; `rebase` clears it once the stored value matches the whole submitted field. Navigation keeps it in `settingsStore`, and reloading drops it.
- `TableDraft` supplies the draft to `RowsTable` and `ListTable`. Incomplete rows and duplicate keys block submission; leaving the adding row or pressing Save marks its missing cells with the field-error style. Whitespace is trimmed on submission. Add and Enter still append a row and clear the adding cells (Ctrl/Command+Enter in multiline cells).
- Source windows also validate pending rows in their other tabs and open the tab holding the error. The project wizard keeps its table input with its other fields and includes it in both checking and adding. A milestone mode uses the pending value too; explicitly changing the mode or restoring inheritance applies to that whole value.

## Token fields

A token count — `stats.checkpointTokens`, `autoCompactWindow`, `codexAutoCompactWindow`, `openCodeAutoCompactWindow`, shared and per project — is a `TokensInput` (`web/src/ui/TokensInput.tsx`, the parsing in `tokens.ts`, with tests).

- It takes `300000`, `300,000`, `30.000`, `300 000`, `300k`/`300к`, `1.5k` and `1m`, groups the thousands with a comma while they are typed, keeps the caret among the same digits, takes a Backspace or Delete on a separator for the digit beside it, and turns `300k` into digits on blur.
- The draft holds the digits without separators, so a count typed back as it was is no change.

## Choosing a provider

The Agent section in project settings → Sessions and shared settings → Providers and models uses `ProviderChoices`: one block per offered provider, with its model and account (also execution and CLI version in shared settings).

- The block or its corner radio selects the default provider; editing its fields, opening help or picking a portalled account option does not. Other providers' fields remain editable because a task's run can select them.
- The Provider caption holds its help, project inheritance and draft/error notes.
- Selecting the provider the saved value already runs restores that value (`inheritedEdit`): picking back an inherited one keeps the project "as shared", with no draft.
- Only the selected radio is in the Tab order; arrows wrap through offered providers, Home/End select the first/last, and Space/Enter select the focused radio.
- A model field, here and on `/settings`, stays free text suggesting the row's account's models (`SuggestField`, `useModelCatalog` → `POST /api/models/list`, BTN-336, BTN-583; `docs/sessions/models.md`, "Model lists"), none when the account lists nothing, and cleared when an account switched in the form lists everything but the model (`useModelReset`, BTN-582).
