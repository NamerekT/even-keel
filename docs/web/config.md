# Page: live config and shared settings

How the settings apply live and are saved, and the groups of the shared settings page `/settings`. What both settings pages share — layout, inheritance marks, tables, the draft and its save bar — is `docs/web/settings-forms.md`; the project's panel is `docs/web/project-settings.md`; every key with its levels and who writes it is `docs/settings.md`.

## Live config (`src/config-store.ts`)

- The settings are in the state database (`docs/storage.md`), and the service looks at them every 2 s, so a `config-import` applies on the fly too.
- Every key applies at once (BTN-130): `ConfigStore.current` is the last valid parse, and `onChange(before)` lets the service rebuild what a key feeds (`projectsChanged` in `src/service.ts`: trackers, CI watches, packages, the chain of a renamed or removed project — `docs/chain.md`). The page has no restart marks. What still needs a restart is a few start-only environment variables (`docs/service/start.md`, "What applies on the fly").
- The address is `EVEN_KEEL_HOST`/`EVEN_KEEL_PORT` (`listenOf`), not config keys (BTN-117); an imported file that still has `host` or `port` gets one warning in the log.
- Settings that do not parse (written past the checks): the last valid ones keep working, the error goes to the log, to a banner on the page (`ConfigBanner`) and, when its notice names a field (`fieldOf`, `web/src/pages/settingsField.ts`), under that field.

## Saving

The page edits the settings; a hand edit is `config-export`, edit, `config-import`.

- `EvenKeelState.config` (`ConfigView`, built by `formsOf`) holds the effective values as forms — `shared: SharedForm`, `projects: Record<key, ProjectForm>` — with the trackers the form can pick (`TrackerChoice`, with the key a project names its tracker project by).
- Saving takes the settings in the config's format (`ConfigStore.raw()`), sets the keys of the fields the form changed (`withProjectForm`, `withSharedForm`), parses the whole result with `parseConfig` and, only if it parses, applies it and writes it into the database behind.
- "Changed" is against the base the save sends with the form (BTN-128): the values its draft started from, not the settings as they are now, so a field imported under an open form is not written back over (`baseOf` in `src/server.ts`, a missing base is `request.required`).

### What a save writes

- A value the form did not change keeps its key as written, even if it repeats what it would inherit.
- A changed one is written only where it differs from what it would inherit — a project's `brief` and `chain` rules from the shared ones, a shared key from the default — otherwise its key goes. A project's `tracker` is always written: it inherits nothing (BTN-345).
- A project clearing `active` or `terminal` over a shared list writes `null`: back to the status categories.
- A string project entry becomes `{ repo }`, an empty value removes its key, an empty `commands` goes away; comments are impossible in JSON anyway.
- `commands` is an object so that commands after the agent's work get a key of their own; an unknown key in it is a config error.

## Shared settings (`/settings`)

BTN-117. `web/src/pages/SharedSettings.tsx` owns the page and its fields; its draft conversion and comparison are in `web/src/pages/sharedSettingsForm.ts`. The page is the first item of the gear menu at the end of the header (a row of the narrow screen's sheet).

- The groups are a left column (`web/src/pages/SettingsNav.tsx`, sticky; up to 760 px a button with the open group's name opens it as a drawer from the left). The list of groups and their keys is `GROUPS` in `SharedSettings.tsx`.
- Every group but those marked "no draft" below uses the draft and the save bar. The save sends `POST /api/settings` with `{base, ...SharedForm}` (`sharedFormOf`, `ConfigStore.saveShared`).

### The groups

- **Chain**: Running — the "Unattended" switch, `parallel`, `switchOnLimit`; Tasks — `brief`, `fillMilestone`, `defaultGit`. The "Unattended" and "Trim the tools" switches are Even Keel settings (`unattended`, `trimTools`) sent at once through `chain/unattended` and `chain/trim` (`ConfigStore.saveChainSwitches`), outside the draft and the bar.
- **Trackers and CI** (BTN-355, no draft): the connections before the rules over them. The profiles' card (`SettingsProfiles.tsx`), a tracker profile's row with "Rules" opening its tab of Chain rules, the `sessionsPending` band above the rows; each profile is saved by its dialog. "Add profile" links (`?profile=<kind>`) land here, and so do the tab id `secrets` and the notices of the former "Access" tab, which this group replaced.
- **Chain rules**: "Whose rules" at the top, a `Select` rather than tabs, since a dozen tracker profiles do not fit a strip. "All trackers" — the shared chain rules, then "Project tasks" with the milestone rules — and an option per tracker profile, with its icon and "own rules" after a profile that sets rules or status moves (BTN-66, `ProfileRules.tsx`, saved on its own through `profiles/rules`, `docs/trackers/profiles.md`, "Profiles"). The pick shows only with a profile; a profile's option is the group's tab id `profile:<id>`. The rule form is described in `docs/web/project-settings.md`, "Chain rules".
- **Providers and models** (BTN-173, `docs/sessions/models.md`, "Run profiles"): `provider`, per provider its model (free text, empty is the CLI's default), its account from `/accounts` (`accountOptions` in `web/src/pages/settingsRun.ts`), its execution (`execution.claude` is the transport of Claude sessions, BTN-353), CLI version and auto-compact window; then `prompt` (Even Keel's prompt, before every project's own, BTN-338), `modelPrompts` and `promptLanguage`. `modelPrompts` is a table of provider/model patterns and their text (`ModelPrompts.tsx`), with catalogue suggestions and matches grouped by provider under each row; all matching prompts apply in table order, no known matches is a warning, and the draft value is the rows as JSON. The provider blocks are "Choosing a provider" in `settings-forms.md`.
- **Sessions**: `protection`, the "Trim the tools" switch, `hiddenSkills` (a table suggesting the skills sessions of all projects received, from `/tools`), `context` (`warn`, `danger`), `contextHandoffs` (BTN-255; off, it disables the two after it), `stats.checkpointTokens` and `stats.checkpointShares` (they steer the sessions, though the keys live under `stats`); then a section of `cacheTtl` and `keepWarm` under the label "Claude Code" — what only one agent honours goes under that agent's heading — and `chatSessions` under "Chats".
- **Check and CI**: `ci.guard`, the kinds, the wait, `recheckMain`, `fixTask`, `rerunFailed`, `landingHold` — the value of every project that has none of its own.
- **Packages** (BTN-802, no draft): the package catalog, `PackageCatalog.tsx`, every change sent at once; `?package=<name>` opens this group with that row unfolded (`docs/packages/page.md`, "The page").
- **Interface**: `language`, the theme, the `updates.check` and `updates.notify` switches, `attachmentLimit`.
- **Sign-in and devices** (BTN-1619, `SignInSettings.tsx`, `docs/web/sign-in.md`): first "Page addresses" with `allowedHosts`, a table and the group's only draft field, since the names decide who opens the page and which passkey works where (BTN-1660); then the passkeys, the devices signed in, and "Sign-in by key" with the owner key (`PageToken` in `SettingsSecrets.tsx`: a secret field whose placeholder says whether it is set, "Save" sending `secrets/set` and "Remove" `secrets/remove`), each change sent at once.
- **Machines** (BTN-1660): "Connecting machines" with `machinesAddress` (`HubAddressField`) and, while there is no machines panel, "+ Machine".
- **Backups**: `backupDir`, `backupKeep`, the last copy and its check (`BackupStatus.tsx`), and `memoryMirror`. The copies are `docs/storage/backup.md`; the mirror `docs/sessions/memory.md`.
- **Notices** (no draft): a switch per notice kind (`NoticeSettings.tsx`, `docs/web/header.md`), each applied at once as "Don't show again" on a banner is (BTN-759).
- **Stats**: "Where stats are written" (the Tally mode cards, the Postgres fields and "Check and save" in one card), "Span classifier" (`ClassifierSettings`: the three `TALLY_LLM_*` variables in one form of its own, "Save" sending only what changed through `secrets/update` — `classifierChanges` in `classifier.ts`: a cleared address or model removes it, a blank key keeps the saved one), "Before/after comparisons" (`minTasks`, `minSessions`, `days`), and "Other" with `stats.otherBelow` and `stats.moves`, a "from"/"to" table.

### Credentials

A credential's row names it in words; its variable is in the row's tip, with "set in the service's environment" for one the page cannot change (its field is off). What is written where is in `docs/settings/levels.md`, "Credentials (BTN-131)".
