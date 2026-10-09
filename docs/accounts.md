# Claude accounts

Reference for sessions: account folders, sign-in, switching, transferring the shared configuration.

## Folders and sign-in

- One configuration folder per account (`CLAUDE_CONFIG_DIR`): the global `~/.claude` (key `global`) and `~/.claude-accounts/<name>` (`EVEN_KEEL_ACCOUNTS_DIR`).
- The CLI itself stores and refreshes the tokens; Even Keel reads only the expiry times from `.credentials.json` (`expiresAt`, `refreshTokenExpiresAt`) and neither reads nor copies the tokens. `claude auth status --json` runs for each folder once a minute.
- "Add account" — `claude auth login --claudeai` in a temporary `.pending-*` folder; after sign-in the folder is named after the e-mail. "Renew sign-in" — signing in again in the account folder. The page shows the link and the code field in the account menu.
- Removing — `claude auth logout` and the folder goes away (not the active one, not the global one). If there are live sessions, the folder is marked (`removing` in `state/account.json`), cannot be switched to, and is deleted at the first check after they end (the menu names the ones holding it); "Don't remove" clears the mark.
- A live session of a folder is one with a live process (a `sessions/<pid>.json` entry), not by `state` from `claude agents`: `blocked`/`working` stay there even for a session whose process and daemon died long ago, and such entries interfere neither with removing the folder nor with stopping its daemon (`liveSessions`).
- `*.lock` folders are locks the CLI puts next to an account folder while a token is refreshed; they are not accounts.
- The account e-mail in `auth status` is the saved profile from `.claude.json`, not the token owner: the Claude desktop app runs the CLI in `~/.claude` with its own account and rewrites the profile, so keep in `~/.claude` the same account as in the app.

## Active account

- The active account can be switched (and the active one's sign-in renewed) when the chain is paused or stopped and no session of the active account is mid-turn — `busy` or `waiting`; the menu lists what is in the way.
- While signing in to the active account is in progress, or it is not signed in or its sign-in has expired, new sessions are not started (the chain pauses with a reason).
- `state/account.json` — the active account and, for each folder, its account, since when it has been in effect and which one was before it. Folder limits received before the account change in it are not shown; the account that hit a limit is the session's folder and its e-mail at the time of the limit, and `--resume` only if the same folder with the same e-mail is active.

## Accounts panel (`AccountMenu`)

- A side panel on the right: account folders, the Even Keel account ("Give to Even Keel" — the active account of the chain) and app accounts (`src/account/apps.ts`, `src/account/vscode.ts`).
- For now there is one app — VS Code: its account is `CLAUDE_CONFIG_DIR` in `claudeCode.environmentVariables` of the user `settings.json` (`%APPDATA%\Code\User` on Windows, `~/Library/Application Support/Code/User` on macOS, `$XDG_CONFIG_HOME/Code/User` or `~/.config/Code/User` on Linux); `global` means no variable.
- The file is rewritten only if it is pure JSON (with comments it is an error in the panel, fix by hand); other keys, indentation and line endings are preserved.
- Switching is impossible while any Claude chat is open in VS Code — a live `sessions/<pid>.json` entry with `entrypoint: "claude-vscode"` in any account folder (polled every 5 s and again before writing); the chain and Even Keel sessions do not interfere. Before writing, the shared configuration is transferred to the folder (`DaemonRefresh.prepare`).
- The account an app sits on is not removed. VS Code picks up the new account after Developer: Reload Window.
- The Claude desktop app is not included: it passes its own sign-in to the CLI, and its configuration folder cannot be switched.

## Transferring the shared configuration (`src/account/share.ts`)

- Before every launch in an account folder, the following is transferred into it: `settings.json` (the global one on top of its own), `CLAUDE.md`, the plugin registry, a junction (a symlink outside Windows) to `agents`, `hooks`, skills and project memory. Memory begun inside an account folder (a real folder, not a link) is first moved into `~/.claude/projects/<project>/memory`: files the shared folder lacks are moved, identical ones dropped, and a file with the same name but different content stays where it is with a warning in the log (merging those, `MEMORY.md` included, is for a human). The folder becomes a link once nothing of its own is left; the walk covers the projects of the account folder as well as the shared ones.
- From `~/.claude.json` — trust and project settings (MCP local scope, `allowedTools`) for projects that are already trusted. The CLI creates several keys for one folder: VS Code writes the drive letter in lowercase — `d:/…`, the CLI — `D:/…` and `D:\…`; a folder counts as trusted if any spelling is trusted, and all its keys are transferred. Path case is ignored only on Windows and macOS, as everywhere Even Keel compares paths — `src/paths.ts`.
- The first-run completion mark (`hasCompletedOnboarding`, `lastOnboardingVersion`), if the folder lacks it: without it an interactive `claude` with the folder's `CLAUDE_CONFIG_DIR` shows the sign-in wizard even though the token is in place.
- The folder's temporary daemon (`claude --bg` starts it itself) caches the configuration: the transfer reaches sessions started after its restart. So if the transfer changed something and there are no live sessions in the folder (a fresh `claude agents` and `sessions/<pid>.json` entries), Even Keel stops its daemon before launching — `claude daemon stop --any` with the folder's `CLAUDE_CONFIG_DIR`; it does not touch the global daemon (`src/account/daemon.ts`). If there are live ones, the daemon is left alone, the account menu says the configuration will arrive after they finish, and the stop is postponed to the first launch without them. The mark lives in the service's memory.
