# Account folders and sign-in

The folders, the OAuth token diagnostics and the active account.

Words used across the area:

- **The global folder** — an agent CLI's own configuration folder (`~/.claude`, key `global`; `~/.codex`, key `codex`). **An added folder** — one Even Keel made itself under its accounts roots (`~/.claude-accounts/<name>` and the like); OpenCode and Copilot have only added folders ([`other-agents.md`](other-agents.md)).
- **The shared pool** — the account each agent runs on by the shared settings, `accounts.<agent>` of the config; **a pool entry** is one agent's line in it, and a project may have a pool of its own (`docs/sessions/models.md`, "Run profiles").
- **The Even Keel role** — the role in an account's row menu (the "roles field") that makes it the account the chain runs on: it writes the shared provider and the pool entry ("Active account" below).

## Folders and sign-in

### Which folders there are

- One configuration folder per account (`CLAUDE_CONFIG_DIR`): the global `~/.claude` and the added `~/.claude-accounts/<name>` (`EVEN_KEEL_ACCOUNTS_DIR`). Codex, OpenCode and Copilot have roots of their own ([`other-agents.md`](other-agents.md)).
- A global folder is hidden until it is registered through Add account (below). The registration is in the state database (`global_accounts`, `openAccountHomes`, `src/account/globals.ts`), never in the CLI folder.
- `*.lock` folders next to an account folder are the CLI's locks while it refreshes a token; they are not accounts.
- A live session of a folder is one with a live process (a `sessions/<pid>.json` entry), never by `state` from `claude agents`: `blocked`/`working` stay there for sessions whose process and daemon died long ago, and such entries hold neither a removal nor a daemon stop (`liveSessions`).

### Adding an account

- "Add account" — `claude auth login --claudeai` in a temporary `.pending-*` folder; after sign-in the folder is named after the e-mail. The page shows the link and the code field in the add dialog ([`page.md`](page.md), "Adding").
- **An existing CLI sign-in (BTN-543).** Picking a provider in the add dialog (from the page, the setup or the project wizard) checks its unregistered global folder once (`account/discover`, `AccountWatcher.discoverGlobal`), without polling its limits. A signed-in identity offers "Use this sign-in" (`account/global`, `useGlobal`, which checks the sign-in again) or "Sign in with another account"; with no sign-in the usual ways open at once, and the browser's Back returns from them. An upgrade from a version before BTN-543 registers, once, the global folders that version showed (`accounts.adoptLegacy`); a fresh install registers none by itself.
- **On a machine elsewhere (BTN-1245).** "Add account" with that machine as "Where it signs in" (BTN-1308), or a press on a machine's signed-out label in a hub account's "Machines" column (BTN-1309), runs the same sign-in on that machine through its CLI: the link and the code pass through the hub, the token stays in the machine's folder (`docs/machines/machine-side.md`, "Signing in on a machine"). A machine also reads the sign-ins of its hidden global folders every 10 minutes (`AccountWatcher.offerGlobals`, BTN-1568), so the hub offers "Use it" for a machine folder of the same e-mail ([machines](../machines.md), "Signing in on a machine").
- **A first account (BTN-227).** The shared pool names `global` and `codex` by default, folders a fresh install may not have. An account added from the page (signed in or on a key) takes its agent's pool entry while that entry names no listed folder of the agent (`takesShared`, `withSharedAccount`, `ConfigStore.saveSharedAccount`); the provider is left as it is. Once the entry names a real folder, a new account does not move it.
- **A CLI that is not found.** Each agent says whether `spawn` without a shell starts its binary (`Agent.installed`, `findBinary` in `src/paths.ts`: a path as is, a bare name on `PATH`; on Windows only no extension, `.com` or `.exe`, so an npm `codex.cmd` shim alone does not count). The service lists such agents in `AccountView.missing`, and the add dialog shows the provider as an off card with where to get the CLI (`CLI_MISSING` in `web/src/accounts.ts`); a sign-in whose spawn fails with `ENOENT` says the same. The page has a card per agent only for agents with accounts ([`page.md`](page.md)). The shared and project settings offer a provider (the provider field, the rows of models and accounts) only once it has an account or the setting already names it (`offeredProviders`).
- **Remote Control of a new sign-in (EKR-148).** Sessions start Remote Control only with `remoteControlAtStartup: true` in the folder's `settings.json` (`remoteAtStartup`). A Claude account added from the page on a claude.ai sign-in (`authMethod` `claude.ai`) gets the key in its own settings layer ([`share.md`](share.md), "Edits in an account folder") and at once by a transfer, so the global settings never take it away. A key, a cloud or a long token gets nothing: Remote Control does not run there. A claude.ai folder without the key is `AccountEntry.remoteOff`: the row's menu and the session panel's "Remote Control is off for this account" (`RemoteOff` `disabled`) offer "Turn on Remote Control" (`account/remote`, `AccountHomes.enableRemote`); the global folder gets the key merged into its own file instead. It works from the account's next session: a live one is never touched (invariant 1).

### Tokens and their renewal

- The CLI stores and refreshes the tokens itself. Even Keel reads only their presence and expiry from `.credentials.json` (`expiresAt`, `refreshTokenExpiresAt`) and never keeps or copies the values. `claude auth status --json` runs for each folder once a minute.
- A folder that needs sign-in is not polled for `/usage`, and its earlier usage warning goes at once (the header's warnings: [`page.md`](page.md), "Usage warnings").
- **Token renewal (EKR-15).** Any call of the CLI may renew the folder's sign-in, and the refresh token is single-use: a call killed between sending the renewal and writing the answer, or two calls renewing at once, may leave `.credentials.json` without tokens and the account signed out (seen on 2026-10-21 after a reboot; the cause is unconfirmed, [unverified](../unverified/accounts.md#staying-signed-in-after-a-reboot-ekr-15)). So:
  - Even Keel's short calls of a folder — `claude agents`, `auth status`, `-p /usage`, `-p /context` — run one at a time (`FolderCalls`, `src/claude/calls.ts`). A call past its timeout is given up on, not killed: it holds the folder until it ends and is killed only after five minutes; a call whose timeout passes while it waits never starts. Launches, `stop` and `daemon` calls go around the queue.
  - The timeout counts the wait: 30 s, and 2 min for `/usage`, since at the service's start it queues behind a `/context` probe per session (about 5 s each, slower under the start's load; BTN-632). `/usage` and the `claude agents` the chain waits on — the session showing after a launch or resume, the listing before and after a stop (EKR-102) — go ahead of the other waiting calls and wait only for the running one (BTN-635). Such a listing that still times out in the queue is tried again without using up its 30 s, up to the five minutes after which the running call is killed (`QueueWait`), so a slow start does not pause the chain.
  - `auth status` and `/usage` wait until the provider's API answers (`Reachability`, `src/account/network.ts`: any HTTP answer from `api.anthropic.com`, `api.openai.com` or, for OpenCode, `opencode.ai` — `openrouter.ai` for a folder on an OpenRouter key — probed at most every 30 s), since the service starts before the network after a reboot. Meanwhile an account keeps what it showed and `/usage` tries again in 30 s. The log says once when the API stops and starts answering.
  - The CLI leaves a `.oauth_refresh.lock.owner.tmp.<8 hex>` behind when writing the owner of its renewal lock fails half-way; they came in bursts of hundreds while a token waited for renewal. Before each `auth status` such files older than an hour are deleted (`sweepRefreshLeftovers`, `src/claude/leftovers.ts`).

### When a sign-in ends (BTN-1443)

- A claude.ai sign-in lives about 30 days, use does not extend it, and it may end any moment of a window: `claude auth status --text` says `Sign-in ends: between <early> and <late>` ([docs](https://code.claude.com/docs/en/authentication), "Check when a stored login ends"). The late end is `refreshTokenExpiresAt`, the early one 3 days before it (`loginEndsFrom`, `web/src/account-state.ts`).
- The page counts to the early end: the days left, "Renew" next to them in the last week, the yellow problem a day before it, "any moment now" inside the window; the tip of the days left names both ends. Only `needsLogin` — past the late end, or the CLI signed out — makes it an error.
- "Renew" signs in again in the same account folder; the link and the code field are in the sign-in dialog ([`page.md`](page.md), "The sign-in dialog").

### Removing an account

- An added folder: `claude auth logout`, then the folder goes.
- A global account: only its registration is forgotten; the folder and the CLI's sign-in stay, with no logout.
- Removal is refused for:
  - the active account;
  - an account a pool entry names — the shared pool's (`account.sharedPool`, its menu item opens Settings → Providers and models) or a project's own (`account.projectPool`); `AccountView.pool`, `poolEntries` in `src/config.ts`;
  - the shared pool's built-in default (`DEFAULT_ACCOUNTS`, `PoolEntry.byDefault`) only while a project runs on it by its provider (`AccountEntry.projects`, `account.projectPool` too); otherwise the default is no pick and keeps no folder, and once its folder is gone the next account of the agent added takes the entry, as a first one does (BTN-644).
- With live sessions the removal waits until they end; the menu names the sessions holding it, and "Don't remove" clears the mark.

### The name of a folder across sign-ins (BTN-528)

- **The ledger** `state/account.json` (`AccountRecord`) keeps for each folder its account (the e-mail), since when it is in effect and which one was before; a sign-out notes nothing and does not clear it. An API, long-token or cloud account's display name is there too ([`claude-kinds.md`](claude-kinds.md), "The account's name").
  - Limits received before the account changed in a folder are not shown. The account that hit a limit is the session's folder with its e-mail at the time, and `--resume` is used only if the same folder with the same e-mail is current.
  - An account without an e-mail (OpenCode or Copilot on the machine's sign-in) is told by its folder key, in the current view and in `accountAt` alike, an empty ledger included; its e-mail stays null. A folder that signs in with no e-mail after one it was noted with (a key folder reused by OpenCode) is noted with a null e-mail from then on (`noteAccount`): otherwise every limit of its sessions looked like an account switch, and the chain handed over to a new session on the same spent account again and again.
- **Readiness** needs `loggedIn: true` and no `launchBlock`, not an e-mail (BTN-537): so a task stopped by a red main goes on after the fix on such an account by a warm resume, not a handoff.
- **The name on the page.** A folder whose sign-in shows no e-mail gets the ledger's last one as `AccountEntry.lastEmail`, and the page names it so (`accountName`); with none known, a signed-out folder is named by its folder (`~/.claude` for the global one), not by its provider.
- **Another account in the folder.** Signing another account in to a folder takes over the name: the user's own name for the folder goes with the old account (`noteAccount`). Two cases show as an error in the problem band under the row, with "Sign in" (`signInMixup`):
  - a folder named after one account (`folderName`, `namedAfter`) holding another carries `formerEmail` (`formerOwner`);
  - two signed-in folders of one agent with one e-mail: every one but the rightful holder (global, or named after the e-mail, else the first) is marked (`sameAccountAs`).
- The account is told by the e-mail of the CLI's saved profile, since `auth status` gives no token `accountUuid`. That profile is in `.claude.json`, and the Claude desktop app rewrites the one in `~/.claude` with its own account: keep the same account there as in the app ([`page.md`](page.md), "The Claude desktop app").

### The macOS Keychain (BTN-742)

A CLI signed in where the login keychain is open (the desktop session) keeps the sign-in in a Keychain item instead of `.credentials.json`: `Claude Code-credentials` without `CLAUDE_CONFIG_DIR`, otherwise `Claude Code-credentials-` and the first 8 hex of the sha256 of the variable's value in NFC — the folder's absolute path as `claudeEnv` gives it (`src/account/keychain.ts`). Seen on a Mac: [verified](../verified/accounts.md).

- **Reading.** With no file, Even Keel on macOS reads the item with `security find-generic-password -s <name> -w`, parses the same two times and drops the text; an answer is kept for a minute. A read over 3 s may be held by an access dialog: that item is not asked again until a restart, and the folder's times stay unknown. An item is never scanned for. Under the launchd agent the read needs no dialog.
- **Carrying it on a rename.** "Add account" signs in in a `.pending-*` folder and then renames it, so `AccountHomes.place` carries the item to the new path's name (BTN-745, `KeychainCredentials.move`): it finds the old item by `-s` alone and takes its account from the attribute dump (`"acct"<blob>=…`), where the CLI writes the macOS user name, not the `claude-code-user` its binary also holds (BTN-748). It reads the old secret, writes it under the same account as the CLI does — `security -i` with `add-generic-password -U -a <account> -s <name> -X <hex>` on stdin, never in the arguments — and deletes the old item. An item already under the new name, whatever its account, wins and only the old one goes; a failed write keeps the old one. Every way the carry stops — no old item, an unreadable one, a failed write — leaves a `Keychain:` line in the log.
- **Removal.** Removing a signed-in account signs it out first, and the CLI's logout deletes its item. Items of folders renamed before BTN-745 or deleted by hand stay until deleted by hand (`security delete-generic-password -s <name>`).

### Two links of one sign-in (BTN-1292)

- The CLI builds two links from one PKCE: the manual one (`redirect_uri` on `platform.claude.com`, the code to paste), which it prints, and its own (`redirect_uri=http://localhost:<port>/callback`), which it only opens with `BROWSER` (on Windows without it, `rundll32 url,OpenURL`) and which ends the sign-in by itself. Under the service no browser opens in session 0.
- So `authLogin` sets `BROWSER` to a program of its own (`openLoginBrowser`, `src/claude/login-browser.ts`): a `.cmd`, or an `sh` script elsewhere, in a temp folder of the sign-in, that appends the link to a file next to it and opens nothing; `%1` with its quotes, not `%~1`, else `&` cuts the link. The file is polled every 500 ms and goes with the CLI's exit; the link reaches the watcher through `Agent.login`'s `onLocalLink` as `AccountLogin.localUrl`, and the dialog offers it as "On this computer" next to "From another device".
- The listener is on the loopback of the CLI's machine, so `MachineLogin` leaves it out: a sign-in on another machine of a hub has the manual link only. Other agents have no `onLocalLink`.

## OAuth token diagnostics (BTN-763)

The diagnostics only write to the log; the page, the account status and running sessions do not change by them.

Before each Claude `auth status`, a registered `global` folder included, `src/claude/oauth.ts` reads `.credentials.json` and the adapter keeps only token-presence flags, expiry times and the file's `mtimeMs`, by `home.key`, until the service restarts. The log records tokens becoming empty, an increased access expiry, and tokens returning. A first reading is a baseline; already empty tokens produce one `OAuth tokens empty since` line. Repeated readings and changes of mtime alone are silent. Times are ISO UTC with milliseconds, taken from the file rather than the poll.

An emptying line includes the previous access and refresh expiry, the selected CLI's version, live PIDs from `sessions/*.json` (`liveRecords`, without calling `claude agents`), and other already read folders whose credential mtime is within five seconds in either direction. This shows correlation, not which process wrote the file or why. Unknown dates, a failed version read or failed session diagnostics say `unknown`; no sessions or peers say `none`. No token values, lengths or prefixes reach the log or the retained shape.

Both token fields must be strings for a valid reading; either nonempty means tokens are present. Missing or unreadable files, malformed or incomplete JSON, absent OAuth objects and files changed during a read are skipped without clearing the last valid reading. Keychain credentials are not observed. A real CLI emptying still needs the [next natural occurrence](../unverified/accounts.md#claude-oauth-token-emptying-diagnostics-btn-763).

## Active account

- **Where it is.** The active account is the shared provider's entry of the shared pool, `accounts[provider]` of the config (BTN-173): the account pool of the run profiles (`docs/sessions/models.md`).
- **What moves it.** The Even Keel role on an account, Claude's or Codex's, writes the shared `provider` of that account's agent and its pool entry (`ConfigStore.saveActive`, `withRunAccount`). So it moves only projects without their own `provider` or account entry; a project with them runs on those.
- **What the header shows.** The shared account, then every other account a project runs on by its provider's pool entry (`projectsByAccount` in `src/config.ts`, `AccountEntry.projects`), each card naming its projects (BTN-175).
- **What stays on `accounts.claude`.** What only Claude has — the `.claude.json` sessions read, MCP failures, the tools view — stays on the shared Claude account (`claudeAccount` in `src/service.ts`).
- **The project's commands** (`beforeStart`, `check`, `afterGreen`) run in the environment of the account the task's session runs on, not the shared Claude one (EKR-26, `docs/chain/worktrees.md`).
- **Switching** is allowed at any time, a running chain included: it only picks the folder for new launches. Sessions of the previous account, mid-turn or not (VS Code chats included), stay where they are, and the chain's next session starts on the new account (`switchProblem`). The roles menu says so under "Even Keel".
- **Renewing** the active account's sign-in rewrites the folder's tokens, so it waits until every chain is paused or stopped and no session of the account is mid-turn (`busy` or `waiting`). A folder with no sign-in (signed out, its tokens emptied by the CLI, or its login run out) has no tokens to guard and no chain session starts in it, so its sign-in waits only for its sessions mid-turn (`renewBlock`, BTN-1731). The refusal says what holds it; a running chain comes with "Stop the chain" under it.
- **No new sessions** start while the active account is signing in, is not signed in or its sign-in has expired: the chain pauses with a reason.
