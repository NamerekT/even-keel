# Accounts on the page

The drawer, the page, adding and switching, credits, a machine's accounts, the desktop app.

## Accounts: the drawer, the page, adding, switching (BTN-169)

The four agents — Claude Code, Codex, OpenCode, Copilot — share the server's `account/*` commands and the page's parts (`web/src/layout/accountParts.tsx`).

### The account in every place

- **The name** (`accountName`, `web/src/accountName.ts`) is shared by the header, drawer, page, settings and statistics: the given name, else the e-mail, else the provider, numbered when names coincide. The folder key stays its identity and is in the mark's tip. Rename is in the row menu: Apply saves through `account/name`, Cancel or Escape drops the edit, an empty name restores the default. Only the display name changes, never the folder.
- **The mark** (`AccountMark`) is a coloured dot and a muted agent icon before the name; its colour follows `entrySlot` in `web/src/accounts.ts`. Its tip (`Tipped`) holds the agent, the connection, the sign-in left, the folder and pending configuration. Shared subscription limits have a separate ⇄ mark with `sharedLimitText` in its tip; source and freshness are in the percentages' tips (`staleText`, `limitsNote`).
- **The pill of a session.** Every place that shows a session — the current chain row, the session panel and its list of the task's sessions, the session and transcript windows, the last session on `/tools`, a task's session timeline on `/stats` — names its account with a pill in the account's colour (`AccountTag`; the colour is the folder's place among the keys sorted, `accountSlot`). The pill finds the account by the folder key or the e-mail the session holds (`accountOf`) and shows its `accountName`, the key and e-mail in the tip; an account no longer listed shows the e-mail's name part. A live session's account is its folder; a finished one's is the folder holding its transcript (`TranscriptOwners`, `src/sessions/owners.ts`, rescanned at most every 5 min on a miss), with the e-mail the folder had at the session's start.
- **Limit bars** turn amber from 80% and red at 100%, in the panel and in the header.

### The row menu

- `AccountRowMenu` (`rolesOf` in `AccountRoles.tsx`) opens by clicking the row or Enter/Space on its button; the row's background and its overlay button share one toggle, while tips and controls inside keep their own actions (sessions, transport, shared limits).
- **Its place.** The left edge follows the click's X in the viewport, kept inside the window; it opens below the row, or above when space is short. Enter/Space anchors it at a third of the row button's width and clears an earlier click's X.
- **What it offers.** The real roles: Even Keel on every agent, VS Code on Claude. Held roles have a check; unavailable roles and Remove show their reason and stay reachable by keyboard. Rename opens a modal; Remove uses `removeProblem` and `ConfirmDialog`. Arrow keys move, Escape closes and returns the focus.
- **Role chips** name Even Keel in accent, apps in green and "Not used" with a dashed outline; unused names are muted.
- **At 760 px and below** the menu's head, before the roles, holds the row's counters (`MenuMeters`, BTN-1043): the plan's windows and the models' weeks (BTN-805) by their full names with the used percentage and the reset, then one muted line with the reading's source and age and the outdated or stale notes. It is no item and takes no focus; accounts that show sums instead of windows have none, and a wide row, which shows the counters itself, never repeats them.
- **Working now** (`AccountWork`) — the account's live sessions under the roles: chain and Even Keel sessions by their CLI name, VS Code chats by their tab title with "VS Code · working/open". The title is the last `custom-title` in the transcript, else the last `ai-title` (`titleOf`, `ChatTitles` in `src/sessions/title.ts`, which reads the transcript's last 256 KB and caches it by size); without either, the CLI name.

### The drawer

`AccountPanel` (`web/src/layout/Account.tsx`), 640 px wide for the nested groups, the whole width on a phone.

- **Opening it.** A press on the header's account block, in every view: the hub's accounts on the hub, in "All machines" and in the own machine's view, a machine elsewhere's in its view ([machines](../machines.md)). The burger has one Accounts button with the active account's tightest used percentage and a red dot for account errors; it opens the drawer of the view (`ViewAccountPanel`). Pointing at the block still shows the read-only levels, with no link to the page.
- **From the top:**
  - under its title and ×, two buttons of one size: "+ Add account" at the left (closes the drawer, opens the add dialog) and "All accounts →" at the right, to `/accounts` (in a machine elsewhere's view `/accounts?machine=<id>`);
  - the summary of the accounts with problems (`AccountProblems`, below);
  - the yellow band of `settings.json` changes made right in a folder (`AccountSettingsEdits`, [`share.md`](share.md), "Edits in an account folder");
  - the page's agent cards and connection groups in the page's order, the chain's account first, other accounts at work before idle ones.
- **A smaller copy of the page** (`AccountGroups` without `page`, `accountRows.tsx`, `accountRows.css`):
  - two columns: the account with its role under the name, and the limits or the two sums;
  - short window names: "5 h", "wk", "mo".

### The page `/accounts`

`web/src/pages/Accounts.tsx`, the whole width, reached by the drawer's "All accounts →"; "+ Add account" in its head. It uses the same problems summary, agent cards and row menu as the drawer (BTN-576).

- **Cards.** One per agent with accounts — Claude Code, Codex, OpenCode, GitHub Copilot — with its icon in a 28 px frame, the count and "+ Add"; an agent with no accounts has no card, and Add account in the head adds one. The Claude Code card alone also has the Even Keel marketplace action before Add (`AccountMarketplace`, EKR-62): a small registration button while unknown, a quiet check mark when registered. Its tip explains manual sessions and gives the registration and plugin-install commands to copy. It does not depend on a sign-in, is disabled while its command runs and absent with no marketplace data; errors use the page's error notice, with an installation instruction when the Claude executable is missing; the registration is read from the server after a reload, nothing is stored locally.
- **Connection groups** inside a card (`accessOf`, `accessGroups` in `web/src/accounts.ts`): Claude subscription, Anthropic key, Amazon Bedrock, Google Vertex AI, Microsoft Foundry, ChatGPT, OpenAI key, OpenRouter key (BTN-843), OpenCode Zen, GitHub (GitHub Copilot inside OpenCode).
  - An OpenCode folder goes by the provider whose limits it shows (ChatGPT, then Copilot), a key folder by the key's provider, one with neither is Zen. An OpenCode folder on Copilot sits in its GitHub Copilot group with the role "Not supported yet" instead of "Not used" (BTN-573).
  - A cloud account's group has its region where the others show the plan; Vertex's has its project in the tip, Foundry's its resource instead of the region.
  - The plan (pro, max, plus, free) does not split a group and stays a tag after the name.
  - A group's 3 px stripe is the colour of who bills it (`ACCESS_OWNER`, the `--owner-*` tokens: `--owner-aws`, `--owner-google`, `--owner-microsoft`, `--owner-openrouter`…).
  - Each group has its head: its name, the count (a pill tinted by the text, since the group's grey fill would swallow the shared `.count-badge`) and the column names.
- **Columns.** Rows share a page-wide grid: account and plan, Used by, limits, Extra usage, Sessions, Runs through.
  - A subscription group's head says only Limits and each window is named in its row (variant 2 of BTN-575), so Plus with five hours and a week, Pro with a week only (`limitSpans` drops a window the provider's answer left out) and Free with a month sit in one group.
  - A key group has Today and 30 days in dollars (`/api/stats/spend`).
  - A group whose accounts have no limit to read has Today and 30 days in tokens, with "No limit to read: the tokens are from the statistics." in the help tip beside its count (BTN-1379); the account's summary has a line for each (`AccountSummary` in `web/src/layout/AccountLevels.tsx`).
  - An OpenRouter key's row gets "Key limit left $X" after the two sums (`KeyLeft` in `web/src/layout/accountRows.tsx`; amber from 80% used, red at 100% or nothing left), its tip saying the limit, its reset period, when it was read and, while no key reads the balance, where to add a management key; then "Balance $X" (`Balance`), red when nothing is left or OpenRouter refused the management key later, the tip then asking for a new one. Where they come from: [`other-agents.md`](other-agents.md), "OpenRouter".
- **Problems** (BTN-1420, `web/src/layout/accountProblems.tsx`).
  - Each account's problems go into one band under its row (`AccountProblem`), its notes and fixes without a path: red for an error (a sign-in needed, a refused or expired key or token, a failed check, the wrong account in the folder), yellow for a warning (a sign-in a day before the early end of its window, [`folders.md`](folders.md), "When a sign-in ends"; a token's last 30 days, a spending cap, a removal pending, a second free account held; `problemTone`).
  - Above the cards one band, red if any of them is an error, else yellow, only names the accounts: "Account X has problems" or "Accounts with problems: A, B", with the agent (`Codex › Work`) where an account of another agent has the same name.
  - Each name leads to its row, whose `id` is `account-<key>`: on the page through the address's anchor, so a copied link or a reload opens on the account; in the drawer by scrolling only. The row then glows once in its band's colour and the focus goes to its fix (`goToAccount`).
- **Usage warnings** in the header cover every account a shared or project pool names, each once and with its card's name, whatever the shared provider. Each is dismissed on its own; the technical reason is in its tip, reachable by keyboard. On `/setup` the usage, CLI check and CLI download banners are hidden; sign-in and downloads are on the agent cards.
- **At 760 px and below** page and drawer show the dot, the name, any spending chip, the role and the tightest used percentage (amber from 80%, red at 100%); windows, extra usage, sessions and transport are hidden, and the name and chip may wrap. The percentage is of the plan's windows only: a spent Fable week does not stop sessions on other models, so an account with a model's own week gets a small tag with the model's name before it instead (BTN-1043). The percentage has no tip there, so a tap opens only the row menu, whose head holds what the tip said. The head's actions wrap.
- Newly added rows glow (`useFreshAccounts`).

### The sign-in dialog

`LoginDialog` (`web/src/layout/LoginDialog.tsx`): a renewal or sign-in started from the drawer or a card opens a modal with its steps (`LoginSteps`, as in "Adding" below), unless the add dialog is open, which shows the same steps itself.

- It follows the server's `account.login`, not the click, so it is there in every tab and after a reload, and goes once the sign-in ends.
- × and Escape cancel the sign-in (`account/cancel`): left running out of sight, it would keep every sign-in button greyed with nothing on screen. A backdrop click does nothing, so a stray click on return from the sign-in tab does not end it.

### Adding (BTN-352)

A modal over the current page (`AddAccountDialog`, `web/src/layout/AddAccountDialog.tsx`, rendered by `App`; the pure part in `web/src/accountAdd.ts`), not a page of its own: the setup and the project wizard stay where they are, and their agent's readiness turns "signed in" after it.

- **The address.** Its state is `?addAccount=<provider>&addWay=<id>` (`addOf`, `withAdd`, `withoutAdd`; `?addAccount=` alone is the provider step), so a reload or a link reopens it. The names are its own because it opens over any page: `add` is taken by the plugin dialog of a project's packages (`docs/packages.md`), `account` by the `/stats` filter and the `dev:fake` fixture (BTN-629). The old `/accounts/add?provider=…` redirects to `/accounts` with the dialog open (`legacyAdd`).
- **History.** An opener pushes a history entry and the provider pick another, each counting its depth in the entry's state (`addDepth`): the browser's Back from the ways goes to the providers, and closing goes back as many entries as were pushed, then drops `addAccount` from the one it lands on.
- **The provider step,** only when none is given: four compact cards; one whose CLI is not found is off with where to get it (`CLI_MISSING`).
  - A provider whose checked copy is not ready, or whose installed CLI is missing, opens `CliDownloadDialog` over the pick (BTN-599). Closing it leaves the pick open (Back to it, or the pick in place of an opener's provider); a finished download goes on to the provider's ways.
  - Where the installed CLI is missing and the service could install it (`EvenKeelState.account.installs`, BTN-1502), the dialog, the banner's `CliActions` and the setup's `CliSourceChoice` show the command with "Install" as the first button (`account/installCli`); its output follows under it (`InstallOutput` in `web/src/layout/CliInstall.tsx`) and the CLI is looked for anew at its end ([machines](../machines.md), "Installing a CLI from the page").
- **The ways in** (`WAYS`): cards to pick (radio, icon, title, one line of what it gives, a check on the picked one), the long text in a "?" tip, and one primary button that names the action.
  - Claude: Subscription, API key, Cloud. Subscription opens a second row of the same cards (`SignFields`, `SIGNS`): "Full sign-in" with what it gives under pluses and one honest minus, "Long token" with only what it lacks; the token card brings the reset warning, the `claude setup-token` command, the token field and "The same account as" ([`claude-kinds.md`](claude-kinds.md), "Long-token accounts").
  - Codex: ChatGPT subscription with the one-free-account rule under it, API key.
  - OpenCode: ChatGPT, Free models (added at once, `NO_SIGN_IN`), API key, with the line that Claude through OpenCode needs a key.
  - Copilot: This machine's sign-in (added at once), Token.
  - A sign-in is `account/add` with the agent and, for OpenCode, the `method`; a key or a token is `account/api` with the agent, the key and the optional name.
- **What is typed** (`Drafts`: the way, the key, the name, per provider) lives in the dialog's state, so Back and forward keep it; the key is never written to the URL or storage. Closing with something typed asks "Discard?" (`dirty`).
- **A running sign-in.** The dialog shows its steps (`LoginSteps`): numbered rows "Open the sign-in page" — for Claude two links, "On this computer", the primary one, and "From another device" ([`folders.md`](folders.md), "Two links of one sign-in") — "Sign in" and the code, the current row lit by `loginRow`, the CLI output folded under them.
  - The rows follow what the person did in this tab, as the sign-in itself is on another site: the first until the CLI gives the link, the second once the link is clicked (any button), the third once the field holds text, the device code is copied or the service took the code.
  - A focus is no step: the dialog opens before the link and focuses the code field meanwhile, then moves the focus to the link once it comes (BTN-529).
  - A backdrop click and Escape do not close it; Back and × ask, then cancel (`account/cancel`). A sign-in already running when the dialog opens shows its steps. A failed one shows its error with "Try again" (`retryBody`) and "Close".
- **A device sign-in** — Codex's or OpenCode's (`deviceLogin`, by the login's `agent`) — has no code field: the one-time code, which goes on the provider's page, is read out of the CLI's output (`loginCode`: the line under "Enter this one-time code", or OpenCode's "Enter code: …") into the login's `deviceCode` and shown apart from the output, large, with a "Copy" button (`DeviceCode` in `accountParts.tsx`; it falls back to `execCommand('copy')` where the page has no clipboard API). A code not read leaves the output unfolded, the code in it (not checked live).
- **Success** — the login turns `null` with no error and no cancel from the dialog, or a key or an instant folder is added: the dialog closes and the new card on `/accounts` glows.
- The focus stays inside (`<dialog>`), Enter on a picked way presses the primary button; under 760 px the dialog takes the whole screen.

### VS Code

For now the only app whose account Even Keel switches; the Claude desktop app is launched on an account folder by hand ("The Claude desktop app" below).

- **Its account** is `CLAUDE_CONFIG_DIR` in `claudeCode.environmentVariables` of the user `settings.json` (`%APPDATA%\Code\User` on Windows, `~/Library/Application Support/Code/User` on macOS, `$XDG_CONFIG_HOME/Code/User` or `~/.config/Code/User` on Linux); `global` means no variable in a file that is there. No file means VS Code is not set up on this host (a container, a server): no account carries the VS Code role and nothing is held by it (BTN-1540); pointing VS Code at a folder still creates the file.
- **The file** is rewritten only if it is pure JSON (with comments it is an error in the panel, to fix by hand); other keys, indentation and line endings are kept.
- **Switching** is refused while any Claude chat is open in VS Code — a live `sessions/<pid>.json` entry with `entrypoint: "claude-vscode"` in any account folder, polled every 5 s and again before writing; the chain and Even Keel sessions do not count. Before writing, the shared configuration is transferred to the folder (`DaemonRefresh.prepare`). VS Code picks up the new account after Developer: Reload Window.
- The account an app sits on cannot be removed.

## Subscription credits and extra usage (BTN-532)

`RateLimits.overage` (`src/limits/overage.ts`) carries what the provider says about paid use beyond the included windows, with its own source and `updatedAt`. A newer window-only reading keeps the last extra-usage reading without refreshing its time; `currentLimits` drops one older than the account's latest sign-in. That paid use is available never means consent to spend: the chain waits for the included allowance (BTN-567).

### What each provider tells

- **Claude through the SDK.**
  - Read: `rate_limit_info.overageStatus` (`allowed`, `allowed_warning`, `rejected`) is availability, `isUsingOverage` current use; an event naming only overage is taken too.
  - Unknown: availability is not the user's extra-usage switch; no balance, dollar ceiling, amount spent or auto-reload setting.
- **Claude on `--bg`.** `-p /usage` gives no extra-usage line ([live log](../verified/accounts.md)), so extra usage stays unknown; there is no parser of an undocumented line and no extra OAuth endpoint.
- **Codex and OpenCode on ChatGPT.**
  - Read: `wham/usage.credits` — `has_credits`, `unlimited` (booleans) and `balance` (a finite decimal string); Codex's rollout `token_count.rate_limits.credits` goes through the same parser. A nonzero balance has not been seen.
  - Unknown: these are usage credits, not USD. `overage_limit_reached` and approximate message counts tell neither auto-reload nor a money ceiling and are not shown; `rate_limit_reset_credits` is not extra usage ("Banked limit resets" below).
- **Copilot and OpenCode on Copilot.**
  - Read: from the quota snapshot that gives the allowance, `overage_permitted` (a boolean) and `overage_count` (nonnegative, finite). The personal premium-request billing fallback also sums Copilot's `netAmount` as USD spent this month — net amounts after discounts, never gross charges for included requests ([GitHub API](https://docs.github.com/en/rest/billing/usage#get-billing-premium-request-usage-report-for-a-user)); it is not asked on top of a quota answer that worked.
  - Unknown: a dollar budget or an auto-reload setting; a count or a bill does not prove a session is spending now.
- **OpenCode Zen.** No balance endpoint usable by the adapter was found, so none is asked or made up. The [billing page](https://opencode.ai/v2/docs/console/billing/) describes the Console balance and auto-recharge; the [API overview](https://opencode.ai/v2/docs/console/api/) gives no balance contract; the upstream [balance API request](https://github.com/anomalyco/opencode/issues/10448) is open. No Console scraping, no browser cookies.

### How the page shows it

- **The Extra usage column** of the wide page follows the included windows: a credit balance, paid USD spent, the on/off permission, availability, or `—` for an unknown source. Tips, reachable by keyboard, name the source, its age and what it does not report. The drawer and widths up to 760 px have no such column and keep `tightestWindow` as it is.
- **The "on credits" chip** (amber, beside the name on the page, in the drawer and on the active header account) shows only while a session is working and the evidence is at most ten minutes old. Claude needs an explicit `isUsingOverage: true`; ChatGPT needs available credits plus a spent included window whose reset is still ahead, and its tip says the spending is inferred. Idle, resting, waiting or signed-out accounts get none, nor do Copilot's past amounts. Extra usage does not enter the red problem band.
- **The paid-usage warning.** Available paid usage adds an amber warning on the account row, on the page and in the drawer. Its tip explains the detection delay — a reaction after a request or a poll, up to five minutes late, no guarantee of zero charges — and recommends the provider's spending controls for chain accounts, with a link: turn off additional usage and automatic credit reload, or set a monthly cap where the provider has one ([Claude](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans), [ChatGPT](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans)). Its policy tip says an exhausted Claude allowance does not confirm payment. There is no setting that allows paid use, and a session's nominal dollar budget is no extra-usage ceiling. How the chain stops such a session: `docs/sessions/limits.md`, ["Stopping paid subscription usage"](../sessions/limits.md#stopping-paid-subscription-usage-btn-577).
- Positive balances, real paid use and automatic refresh through the live service are [unverified](../unverified/accounts.md#subscription-extra-usage-btn-532); BTN-531 holds that check, paid ones only with separate consent ([remaining checks](../unverified/accounts.md#paid-subscription-usage-stops)).

### Banked limit resets (BTN-1269)

- `wham/usage.rate_limit_reset_credits` is how many resets of the limit the ChatGPT account has banked: `RateLimits.resets` keeps `available_count` and `applicable_available_count` (`null` when absent) with their own `updatedAt`. Like the model weeks, they outlive a newer snapshot that does not tell them (a rollout, the hub's copy) and are dropped by `currentLimits` when older than the latest sign-in.
- The row shows "Resets: N" under the name while the count is above zero, the applicable count in its tip; a narrow row shows it at the head of its menu. There is no button: the user spends a reset in Codex or on chatgpt.com, and Even Keel never calls the consume route.
- The expiry is only in the separate `wham/rate-limit-reset-credits` (`credits[].expires_at`), which is not asked: one more request per poll, which Codex itself leaves out of background polls. Not seen with a nonzero count: [unverified](../unverified/accounts.md#banked-chatgpt-limit-resets-on-the-account-card-btn-1269).

## A machine's accounts (BTN-1584)

A machine elsewhere's view (its accounts page `/accounts?machine=<id>` and the header's "Accounts" with the machine picked, [machines](../machines.md), "Signing in on a machine") gives each of the machine's own folders, signed in or not, the hub row's menu (`AccountRowMenu`): Even Keel, VS Code, Rename, Remove. A hub subscription with no folder there has no menu, only "Sign in" there. Each item is done on the machine through the link, never on the hub's disk.

- **The commands** (`machineAccountCommands`, `src/service/machine-account-commands.ts`): `machines/account/remove`, `machines/account/keep`, `machines/account/app` (`{machine, account, app}`), `machines/account/name` (`{machine, account, name}`), `machines/account/switch`, each with `account` the machine's folder, and `machines/key` (an API key into a folder of the machine or a new one, `docs/machines/machine-side.md`). The row menu sends its usual `account/*`, and `machineSend` (`web/src/layout/machineRows.ts`) turns it into the machine's with the row's folder. Remove, Keep and VS Code are the machine's own `account.remove`, `account.keep`, `account.switchApp`: it refuses as the hub would (an app sits on the folder, a chat open in its VS Code), and its refusal reaches the page as its notice code with its words.
- **Removal** waits, as on the hub, for the account's sessions on that machine to end: the machine's card carries `removing` and the account's sessions, so the row shows "removal pending" with Keep; a key folder (`apiKey` on the card) asks "Remove the folder with the key?". The card's `apps` are the machine's VS Code panel, so the VS Code role is the machine's.
- **The name.** The hub knows a machine's account by its agent and e-mail (`hubFolderOf`, `src/account/same-account.ts`: a full sign-in before a long token). Such an account shows and renames the hub folder's name, one for the hub and every machine: Rename on the machine's row writes the hub's folder (`account.rename` on the hub), and a rename on the hub shows on every machine. An account the hub has no folder of — a key, one signed in only there — has its machine folder's own name, renamed there.
- **Even Keel's account** has no machine level: it is the hub's, `accounts[provider]` ([`folders.md`](folders.md), "Active account"), and each machine takes its own folder of the same account (BTN-1311, `docs/chain.md`). Even Keel on a machine's row moves the hub's account of the same e-mail, for the hub and every machine; one the hub has no folder of has the role off with `machines.accountNotOnHub`.
- **Off the link** the menu still opens, its head says the machine is not connected and no item acts; the server refuses any of these commands with `machines.accountsOffline` before sending anything.

## The Claude desktop app

Even Keel does not switch the app's account (BTN-121): each profile needs its own sign-in by e-mail, and the usual ways of starting the app ignore the profile. Whoever needs it launches the app on an account folder by hand. Checked on Windows with the Store (MSIX) build 2.42304.0.0 on 2026-10-17:

- By default the app keeps its data in `%APPDATA%\Claude`, and the Claude Code it starts (its Code tab) works in `~/.claude` with the app's sign-in. It also rewrites the CLI's saved profile there, the e-mail `auth status` reports ([`folders.md`](folders.md), "The name of a folder across sign-ins").
- The Electron flag `--user-data-dir=<folder>` opens a separate profile with its own sign-in, chats and settings. Several profiles run side by side; launching the same folder again focuses its window.
- `CLAUDE_CONFIG_DIR` set when the app is launched reaches the Claude Code it starts: that folder, not `~/.claude`, gets `sessions`, `projects` and `.claude.json`.

```powershell
$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-accounts\<name>"
& "$env:LOCALAPPDATA\Microsoft\WindowsApps\claude-desktop.exe" --user-data-dir="$env:APPDATA\Claude-<name>"
```

- Sign in to a new profile only with "Continue with email". Google sign-in finishes in the browser with a `claude://` link, Windows hands the link to the app without the flag, and the sign-in lands in the default profile instead.
- The Start menu, a taskbar pin, autostart and an update relaunch open the default profile. A Windows shortcut cannot set an environment variable, so a shortcut to a profile has to run the two lines above (e.g. `pwsh -WindowStyle Hidden -Command …`).
- Even Keel cannot launch the app for you: from the service's Windows session 0 it does not start at all ("Access is denied").
- The shared configuration in the folder is as fresh as the last Even Keel launch there: the app's launch does not transfer it.
- Not checked: the installer (non-Store) build on Windows, macOS and Linux. On macOS the same is packaged by [claude-multiprofile](https://github.com/jmdarre-v/claude-multiprofile).
