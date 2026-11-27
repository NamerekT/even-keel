# Transferring the shared configuration (`src/account/share.ts`)

Every Claude account folder sees the same configuration as the global folder `~/.claude`: before every launch in an account folder Even Keel transfers into it what is listed below. The transfer only reads the global folder, apart from moving its memory and skills into their stores, which leaves what its sessions see the same. Only Claude folders get it; another agent's folder does not.

## What is transferred

- **`settings.json`** — the global file, then the account's own layer over it (`null` there removes a key), with a hook appended (below). The merge is shallow: a top-level key replaces the folder's key whole. Two things of the folder survive it:
  - a key changed right in the folder stays until the person decides (["Edits in an account folder"](#edits-in-an-account-folder-btn-901-srcaccountsettingslayerts) below);
  - the folder's own API key, cloud variables and `apiKeyHelper` stay its own (`docs/accounts/claude-kinds.md`).
- **`CLAUDE.md`** and **the plugin registry**.
- **Links** — a junction on Windows, a symlink elsewhere — to `agents`, `commands`, `hooks`, `output-styles` and every shared skill, all in the stores (next section).
- **From `~/.claude.json`**: trust and project settings (MCP local scope, `allowedTools`) of the projects already trusted. The CLI keeps several keys for one folder (VS Code writes `d:/…`, the CLI `D:/…` and `D:\…`): a folder counts as trusted if any spelling is, and all its keys are transferred. Path case is ignored only on Windows and macOS, as everywhere (`src/paths.ts`).
- **The first-run mark** (`hasCompletedOnboarding`, `lastOnboardingVersion`), when the folder lacks it: without it an interactive `claude` with the folder's `CLAUDE_CONFIG_DIR` shows the sign-in wizard although the token is there.

## The stores

All stores live in `~/.claude-config` (`configStore`), the working copy of the global configuration's repository that syncs between the hub and its machines (BTN-1690, `docs/sessions/memory.md`, "The global configuration").

- **`agents`, `commands`, `hooks`, `output-styles`** — each in `~/.claude-config/<name>` (`linkedStore`).
  - A real `~/.claude/<name>` is moved there and a link left in its place, so hook commands in `settings.json` naming `~/.claude/hooks/…` keep working; a missing one is linked back to the store.
  - The account folder's `<name>` links to the store; its old link into `~/.claude/<name>` is re-pointed.
  - A `~/.claude/<name>` that links elsewhere stays, and the account links to it.
- **Skills** — each in `~/.claude-config/skills/<name>` (`skillStore`).
  - A skill kept in `~/.claude/skills` as a real folder is moved there whole and leaves a link; the account's `skills/<name>` links to the store, an old link to `~/.claude/skills/<name>` is re-pointed.
  - A store folder that already holds the skill is merged into as memory is (below). A folder the move cannot rename (a file in it is open) stays, with a warning in the log, until the next launch; the account links to it meanwhile.
  - Left alone: the CLI's own `synced` and `.trash`, a global skill that links elsewhere (a repository's skill folder — the account links to it), an account skill linking to a live folder of its own choosing.
  - An account link left dead by a deleted skill (into the store, an old store or `~/.claude/skills`) is removed (BTN-1736, `docs/packages/files.md`, "The user's own skills").
- **The stores of before BTN-1690**, `~/.claude-<name>` and `~/.claude-skills`, are moved into `~/.claude-config` (`settleStores`, at every transfer and at the start of the configuration's working copy). An old store is renamed to its new place, or merged into it file by file when the place exists (a differing file stays behind with a warning, and the old folder with it). The old place then becomes a link to the new one, so somebody else's hook command or link naming it keeps working; links of `~/.claude` and the account folders into it are re-pointed straight at the new place.
- **Project memory** — `~/.claude-memory/<project>` (`memoryStore`, `sharedMemory`), next to the global folder: both `~/.claude/projects/<project>/memory` and the account folder's `projects/<project>/memory` are links to it. The walk covers the account folder's projects as well as the shared ones.
  - Memory begun in either place (a real folder, not a link) is first moved into the store, the global folder's first: files the store lacks are moved, identical ones dropped, a file with the same name and different content stays where it is with a warning in the log (merging those, `MEMORY.md` included, is for a human).
  - The folder becomes a link once nothing of its own is left; a link pointing elsewhere (the old target in `~/.claude`, a dangling one) is re-pointed.
  - How the store syncs between machines and what agents without the CLI's file memory get is in `docs/sessions/memory.md`. Chain sessions get the store as `autoMemoryDirectory` in `--settings` (`chainSettings`) and no `memory` server (BTN-1647).

**Why outside `~/.claude`.** The CLI asks before every write whose real path lies in a `.claude` folder that is not the session's own, even with `--permission-mode auto`, so a link from an account folder into `~/.claude` stopped sessions on a question. With the stores outside, writes through both links pass ([verified](../verified/accounts.md), BTN-256, BTN-294, BTN-373).

## Edits in an account folder (BTN-901, `src/account/settingsLayer.ts`)

`/model`, `/config`, `permissions` or `skillOverrides` written right in an account folder's `settings.json` (from a terminal, VS Code or a session) would be overwritten by the shallow merge. So the transfer keeps them and the page asks what to do.

- **What is kept.** `AccountSettings` keeps per Claude folder, in the machine's database (`account_settings`, `docs/storage/database.md`), what the last transfer wrote there (`written`) and the account's own layer (`own`).
- **What counts as an edit.** The page and the transfer both use `planSettings`: a top-level key whose value in the folder differs from both `written` and what the transfer would apply. The transfer leaves the folder's value and keeps the old one in `written`, so the edit stays one until resolved.
  - Folder-only keys such as `agentPushNotifEnabled` and `inputNeededNotifEnabled` (written by Remote Control) survive a transfer without a band (EKR-150).
  - Keys the CLI writes with no one asking are no edit: `autoUpdatesChannel` and `minimumVersion` (`claude install`, the update channel; read in the CLI 2.1.319 binary).
  - The CLI's startup migrations also rewrite `model` and `env` (model renames, `DISABLE_AUTOUPDATER`, pins); those stay watched because a person writes them too ([unverified](../unverified/accounts.md#settings-edits-in-account-folders-btn-901)).
  - The first transfer without a record sees no edits; removing an account drops its record.
- **What the page gets.** `AccountEntry.settingsEdits` gives each key with its value from `written` and in the folder as JSON (`SettingsEdit`, `settingsEdit`; cut at 2,000 characters, absent where the key is not there). For `env`, whose values may be secrets, only the names of the variables added, removed and changed. The edits are cached by the layer's revision and the time and size of both files, so the band shows a change before the next launch.
- **The band** (`AccountSettingsEdits`, `web/src/layout/accountSettings.tsx`, BTN-1395), in the drawer and on `/accounts`, next to the problem band: one yellow band per account.
  - Its head names the account and how many keys changed, with "All shared", "All for this account only" and "Discard all" when there are two or more.
  - A row per key: the key, "Was" and "Now" (a long value cut, the whole in a tip; `env` as variable tags) and the key's three buttons. Under 900 px of band (a container query: the drawer, a phone) the key and buttons go over the values, under 520 px the buttons under them.
  - A chosen row leaves at once and comes back if the command fails; the band goes with its last row.
- **The choices.** Each button is `account/settings-edit` with `choice` and `key`, or `keys` for the head's: every key is checked first (one that is no edit any more refuses them all), then the folder is transferred once, with the daemon rule of ["The folder's daemon"](#the-folders-daemon) (`DaemonRefresh.prepare`).
  - "Make shared" writes the folder's value into `~/.claude/settings.json` (an `env` without the folder's API key and cloud variables), removes the key from the account's layer (EKR-151) and transfers it to the folder at once; other accounts get it at their next launch.
  - "This account only" puts it into the account's layer (an `env` there is kept without the API key and cloud variables; the folder's own are put back).
  - "Discard" transfers as before; the change is lost.
- **The layer on the page.** Its keys are listed on the `/accounts` row as "Own settings" (`AccountEntry.ownSettings`, `OwnSettings`); × (`account/own-setting`) drops one and transfers again.

### The hook guarding them (BTN-902, `src/account/settingsGuard.ts`, `settingsHook.ts`)

- **What it forbids.** An `Edit`, `Write` or `MultiEdit` of a listed, non-global Claude account's `settings.json`. The denial tells the agent to edit shared settings in `~/.claude/settings.json` and resolve account-only changes on Accounts.
- **How it is installed.** The transfer appends a `PreToolUse` command for `Edit|Write|MultiEdit` after the account's layer: this installation's Node executable and absolute `dist/src/account/settingsHook.js`, separate arguments, no shell, no plugin.
  - Only added Claude folders get it ([`folders.md`](folders.md)), never the global folder or another agent's.
  - Its `--even-keel-account-settings` marker lets the next transfer replace only its own commands, even one mixed into a user's group; user hooks stay.
  - `AccountSettings` strips it before comparing or sharing settings, so installing, updating or removing it is no edit; empty hook lists compare as absent.
  - A missing global settings file still allows installation and keeps the account's values; a broken account JSON is left intact.
- **How it is removed.** `even-keel uninstall` and both service uninstall scripts strip only marked commands; removing an account removes its file with the folder.
- **When it lets through.** Other files at once, with no service request. For a candidate file (relative paths resolved from the event's `cwd`, `MultiEdit` targets too, compared through `src/paths.ts`) it asks the local service's `/api/state` about the folder's key. No answer within 1.5 s, a failed response or malformed input allows the edit. It never emits an `allow` that would bypass normal permissions, and `onFailure: continue` keeps a missing script from holding edits.
- **What it does not cover.** CLI configuration commands such as `/model`, shell writes and disabled hooks: the edits band catches those. Real CLI delivery and uninstall on each OS await [the live check](../unverified/accounts.md#account-settings-edit-hook-btn-902).

## The folder's daemon

`claude --bg` starts a temporary daemon of the folder itself, and the daemon keeps its own environment: that of the `claude --bg` that started it plus the `settings.json` `env` as it was then. Every session it spawns inherits that and puts the `env` read at its own start on top ([verified](../verified/sessions.md), BTN-129):

- a new or changed `env` key reaches the next session at once, a running session keeps its value;
- a removed key stays in every session of that daemon until the daemon restarts;
- the environment of a later `claude --bg` never reaches its session, so Even Keel passes nothing per session that way. The names of `sessionSecrets` are blanked in chain sessions anyway, since the chain's `--settings` outranks the daemon's environment.

The daemon does not hold the launch folder (it runs in the home folder), so it does not keep a task's worktree or slot from being deleted after Done; Even Keel starts no daemon of its own beforehand ([verified](../verified/accounts.md), EKR-100).

**The stop rule (`DaemonRefresh`, `src/account/daemon.ts`).** Only `env` was checked; whether the daemon holds other parts of the transfer (`CLAUDE.md`, the plugin registry, the links) was not.

- When the transfer changed something and the folder has no live sessions (a fresh `claude agents` and `sessions/<pid>.json` entries), Even Keel stops its daemon before launching: `claude daemon stop --any` with the folder's `CLAUDE_CONFIG_DIR`. That keeps removed keys out of new sessions.
- With live sessions the daemon is left alone, since `claude daemon stop` ends every background session of it, idle ones between turns included. The account menu says the configuration arrives after they finish, and the stop waits for the first launch without them. The mark lives in the service's memory.
- The transfer never marks the global folder. Two things do, with the same rule (its live sessions include the user's own in `~/.claude`):
  - **removing a tracker profile's key** on `/settings` → Trackers and CI (BTN-131, `docs/settings.md`): `DaemonRefresh.expire` marks it; while live sessions hold it, the tab says the removal arrives after they end, and the stop is tried again at the next launch in the global folder. A key written or changed needs no stop: sessions read `env` at their start;
  - **the page's address moving live** (`EVEN_KEEL_PORT`, `EVEN_KEEL_HOST`, `rebind` in `src/service/hosting.ts`, BTN-817) marks every Claude folder, the global one included: a session gets the address as `EVEN_KEEL_URL` from the service's environment (`sessionEnv`, `src/agent/env.ts`), and a running daemon would hand it the old one. A service restart with a new address marks nothing ([unverified](../unverified/sessions.md#hooks-after-the-pages-address-changes-btn-817)).
