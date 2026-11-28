# Fake states: machines, accounts and the page's sign-in

The URL parameters of machines and pools, the header's accounts, models, the configuration conflicts, more account kinds and the page's sign-in. Accounts' basic states are in `setup-limits-accounts.md`.

## Accounts

| Parameter | What it shows |
| --- | --- |
| `?header=one\|two\|three\|long\|tokens\|stale` | the header's accounts on `/p/ABC`: inherited accounts, project overrides, a pinned session over changed project settings, 40-character names, a token-only account and an old reading. Combine with `lang=ru`, `chain=paused`, `chain=close` or a light shot. The fixtures call the server's selector; the page does not choose the account itself |
| `?header=sessionAccounts[-long\|-missing\|-empty]` | Claude and Codex accounts with the same e-mail and distinct names, ABC-5 running on Codex by e-mail: the account pills of ABC-5's session list, its session record and its chat. The suffixes give a long OpenAI name, a missing Codex account and a session without an account |
| `?account=go\|go-long` | an OpenCode Go account with all three windows, an expired Console key and a Console key without Go; `go-long` lengthens the healthy account's name. The expired row has its warning and Replace key; `?addAccount=opencode&addWay=go` opens the Go add form, where a key with `rejected` or `offline` fails; a replacement restores the three windows |
| `?account=connections` | every connection of every agent at once (BTN-576): Claude Max and Pro, an Anthropic key, ChatGPT Plus, Pro without five hours and Free with a month, OpenAI keys without credits (the problems summary, a yellow band under the rows), two Zen folders, OpenCode on ChatGPT, on Copilot, on both keys and on an OpenRouter key, and both Copilot sign-ins — the agent cards and connection groups on `/accounts` and in the drawer |
| `?account=copilot-out\|copilot-out-cmd\|copilot-unknown` | a Copilot folder whose CLI reports no sign-in, beside a working token folder: the sh sign-in command in the band under the row, or the Windows cmd one; `copilot-unknown` — "Could not check" with launches allowed, the phone row included |
| `?account=opencodeCopilot` | an OpenCode folder holding only Copilot (with a monthly allowance) and a mixed Copilot/API-key folder; the shared settings pick the former, so `/setup?step=agent` and the wizard show it as unsupported, and the account choices are off |
| `?account=overage\|overage-long\|overage-permitted` | Claude using extra usage, a Codex account with a spent window and 12.4 ChatGPT credits, an idle OpenCode account sharing credits, Copilot with extra usage off, and accounts with no extra-usage source; `-long` a long active name, `-permitted` Copilot's additional usage on. Paid usage at hand adds `OverageWarning`, the band with the provider's spending-settings action and a policy tip; its controls do not toggle the row's menu. On `/accounts` or in the drawer of `/p/ABC`, with `lang=ru` for narrow rows |
| `?account=mixup` | the sign-in mix-ups of BTN-528: a folder named after another account than the one in it, a second folder of the global account, two signed-out folders, with and without their last e-mail; `/accounts?account=expired#account-global` opens on the signed-out row with "Sign in" focused |
| `?account=model-weeks` | the models' own weeks (BTN-805): Max with five hours, the week and a spent Fable week without a reset, a verified Ultra with the week and Fable, a Team seat with five hours and Fable with a reset, Pro whose answer listed no model week |
| `?chain=modelWeek\|modelWeekUnknown` | a task held by a model's own week (BTN-816), with a reset or without: the chip names the wait and the line under it the model and the reset, on `/p/ABC` and a home card |
| `?models=many` | an OpenRouter-sized catalogue of 323 models for OpenCode and three model prompts whose matches list a few and fold 312 behind "312 more" (BTN-858); with `account=connections` on `/settings`, "Providers and models" (a narrow screen opens the group menu first: `--click 'button:has-text("Chain") >> nth=0'`) |
| `?packages=marketplace\|marketplace-missing-cli` on `/accounts` | the Claude Code marketplace button, its missing-CLI error after a press; the default its check mark. With `account=codex-only` neither the account page nor `/p/DEMO?pkg=1&add=linear@even-keel&packages=marketplace` asks a Codex-only installation to register a Claude marketplace |
| `?configConflict=on\|gone` | two global configuration conflicts in the header's banners (BTN-1692): `settings.json` met on "laptop-01" and a hook with no machine known. A version's tip opens at once on a press (`--click '.config-conflict__version >> nth=3'`); "Keep this" takes the line away; `gone` refuses the choice as settled elsewhere |

## The chain over machines

- `/p/ABC?chain=long` (BTN-1188): 80 more tasks in ABC's first milestone — 50 rows, "Show 16 more of 35" (`--click '.chain__page-more'` for the next step), and the 66th, a question, under the button.
- `/p/ABC?chain=pins` (BTN-1623): four of ABC's tasks pinned to machines of a three-machine pool — each row's machine tag, the reason of a busy and an offline pin in its tip and the offline one dimmed (BTN-1807), a button for a pin to a revoked machine (`--hover '.block__pin'` for its tip); `&task=ABC-7` opens the card with "Machines" under "Runs on".
- `/p/ABC?chain=accounts` (BTN-1805): ABC's two lanes on two machines and two accounts — ABC-5 on the workstation as Even Keel's account, ABC-6 on the home server as jane.roe — so the header in "All machines" shows the project and Even Keel without a focus (`#none`: the hash of no task, since entering focuses the current one) and the focused task's account as the task level with `#ABC-5` or `#ABC-6` (`--hover '.account-block__toggle'` for the levels); `accountsOut` also signs Even Keel's account out on the home server, a lamp on the block's corner (`--hover '.account-block__out-lamp'` for its tip).
- **Machine icons** (BTN-1595): the fake machines cover every kind — the hub and the desktop on Windows, the mini on macOS, the home server on Linux in Docker, the rest on Linux; `?hubOs=linux` puts the hub on Linux. `/p/ABC?chain=lanes&hubOs=linux` shows the hub's circle beside a Docker frame on the chain's rows, `?machines=signIn` the other places (the panel, `/status`, the machine pages, the pool tab, the account place pick).

## Machines (`?machines=…`)

`signIn|login|offline|nocli|token` add two machines elsewhere (BTN-1245): "Example laptop" with no accounts — a sign-in under way, off the link, or without the Claude CLI — and "Example desktop" signed in to every account, with `token` on long tokens (BTN-1002, `.machine-label--token`).

- **On `/accounts`**: each row's "Machines" column (BTN-1309) holds the desktop's label; "Add account" with the laptop picked opens its sign-in window (`login` opens it at once), a code typed there signs the laptop in, and "Long token" there signs it in on a token.
- **`many`** — ten machines: the laptop with the active account's folder signed out (`.machine-label--out`, whose press opens its sign-in window), the desktop, "Example node 3"…"9" (5 and 6 on long tokens, 9 off the link), so the active account's column shows four labels and "+N" (`.machine-labels__more`).
- **Tokens**: `?account=tokenOnly&machines=tokenAlone` (BTN-1266) leaves the hub a long-token row and a signed-out Claude folder the desktop runs on a token nobody polls: the first row says "limits from sessions only" with "Sign in fully", the second the same in the tip of the desktop's label, and `&machine=machine-2` the mark under the desktop's long-token row (BTN-1740). `/accounts?machines=tokenDiffer&machine=machine-2` (BTN-1267) gives the desktop tokens whose windows differ from the hub's poll: "limits differ from the hub's", and "New token" (`.account-machines__row .button`) opens the token window.
- **"Add a machine"** (BTN-1056): `&addMachine=machine-1` opens the laptop's step 3 (git without a user with `signIn`, no agent CLI with `nocli`, off the link with `offline`), `machine-2` the desktop's, an unknown id the "no such machine" state; "Connect" of two projects or more (BTN-1263) fails the laptop's last one at the push check, the desktop's is done at once. `?addMachine=new` alone opens step 1; after "Issue the command" a fake machine joins 3 s later (`--wait '.add-machine__joined'`), and a window closed before that leaves a toast when it joins. In Russian, with the hub's address filled in:

  ```sh
  npm run shot -- '/p/ABC?addMachine=new&lang=ru' 'dialog[open]' --fill 'dialog .settings__text=hub.example.ts.net' --click 'dialog button[type=submit]' --wait '.add-machine__joined'
  ```

- **A project's "Machines" tab** (BTN-1271): with the hub's own "Workstation" they make three `machineNames`, so the tab shows; "Connect a machine" on the laptop fails at the push check (Retry finishes it), on the desktop it is done at once. The laptop connected to ABC from the tab:

  ```sh
  npm run shot -- '/p/ABC?machines=signIn#settings' 'dialog[open]' --click '#settings-tab-machines' --wait '.pool' --click '.pool__actions button' --click 'dialog button[type=submit]' --wait 500
  ```

  With `&machine=machine-1` "Connect a machine" (Retry after the push check, then the window's done button) puts the laptop into ABC's pool with its packages not ready: a package to finish and the tracker's server, each with its line and buttons (BTN-1300).

  A folder name with `partial-clone` (`--fill 'dialog .project-add__name=abc-partial-clone' --wait 1500`) is a clone lacking the hub's `github` remote: the amber strip and "Add remotes", which turns it green (BTN-1806). The same in the "Add a machine" window: `/p/ABC?machines=signIn&addMachine=machine-2` with `--click '.add-machine__row--pick input >> nth=0' --fill '.add-machine__place .project-add__name=abc-partial-clone'`.
- **Machine pages** (BTN-1272): `/machines/pc` the own one, `/machines/machine-1` the laptop with its warnings; wait for `.machine-page__grid`. `taken` (BTN-1262): the laptop's first project's folder held by "Example old laptop" — the band's "Take the folder over" asks to confirm and takes the band off; with `&chain=folderTakenGone` the dialog shows the refusal.
- **The machines panel on `/p/ABC`** (BTN-1051): click `.machine-block` to open it and `.machine-panel .tag--help` for its explanations; `limit` puts the desktop's accounts at a limit till 18:40, `offline` the laptop off the link, `&machine=machine-2` the desktop's view with its strip. In a machine's view (BTN-1279) `.account-block__toggle` opens the header's accounts of the picked machine, `#settings` the machine in the project.
- **A machine's accounts**: `/accounts?machines=signIn&machine=machine-1` lists the laptop's (BTN-1302: none, so the hub's accounts with "Sign in"), its "Add account" the agents' window; `account=tokenOnly&machines=signIn&machine=machine-1` the empty state; `/status?machines=signIn` the machines at the bottom. A machine's own rows have the hub row's menu (BTN-1584, `web/src/live/fakeMachineAccounts.ts`): `/accounts?machines=many&machine=machine-2` and `--click '.account-row__button'` opens the desktop's first; Remove waits 6 s for a session there with "removal pending" and Keep (the second row: the first is Even Keel's and cannot go), Rename of an account with an e-mail renames the hub's too, VS Code moves the desktop's own; `machine=machine-9` (off the link) says so at the menu's head.
- **`pooled`** (BTN-1564): "Example laptop" in every project's pool, with a long commit author and folder and the first project's packages not ready: `/p/ABC?machines=pooled&machine=machine-1#settings` opens its panel in the project with no clicks (`--wait '.pool__block-actions'`), `machine=pc` the own machine's, ready. `/machines/machine-1?machines=pooled` lists every project on the laptop's page; `pooledOff` turns the laptop off in the first project's pool there (BTN-1562; at 390 px the row stacks the name and folder, then "off in the project" and "packages not ready", then "Packages"). `pooledCommands` (BTN-1553) adds "Example desktop" to every pool too, its commands after a green main off, and gives the laptop two own ones, the first too long for a line: `/p/ABC?machines=pooledCommands#settings` with `--click '#settings-tab-machines' --wait '.pool'` shows the three kinds.
- **`tooLarge`** (BTN-1560): the laptop's state is over the link's limit — its card in the machines panel is blocked with the reason, `/machines/machine-1?machines=tooLarge` has the band with the size (`--wait '.machine-page__body'`).

## Sign-in to the page

How the sign-in works is in `docs/web/sign-in.md`; the fake settings group reads `web/src/live/fakeAuth.ts`.

- **The screen**: `/?signIn`; `?signIn=nokey` — no owner key on the hub, `?signIn=elsewhere` — passkeys made only on other names, `?signIn=nopasskeys` — the passkey refused at once, as by a browser without passkeys. The key is `owner-key`, a passkey otherwise passes without the browser's dialog, and signing in drops the parameter.
- **The settings group**: three passkeys on two names and four devices, two of them "Chrome on Windows", one by invitation, this browser one of them. Its band follows the fake `EVEN_KEEL_TOKEN` (unset by default).
- **`&signInOn`** starts with the sign-in an invitation turned on, in the page state too, so the setup's Phone access step is checked (`/setup?step=phone&signInOn`); a fake "Let in" turns it on in the settings group alone.
- **`&invites`** starts with two invitations waiting, one opened; an invitation made in the dialog is opened by a fake phone 3 s later, digits 47. `&invites=soon` makes the links live seconds (the two rows expire 3 and 5 s after the page opens, a new one 6 s after "Invite a device"), so a row dropping and the dialog's "The link expired" can be shot; like the hub, the fake neither lists nor decides an expired one.
- **The link's origin.** dev:fake is open by localhost, so the dialog shows the loopback cases: two known origins by default (`https://hub.example.ts.net:8443` seen last, `http://192.0.2.10:4747`), `&origins=1` the first alone, `&origins=0` none and the address field; a typed address is checked as the hub's `typedOrigin` does.
- **The new device**: `/invite` is a browser signed in already, `/invite?signIn` the new device — let in 3 s after opening, or `&invite=declined|expired|cancelled|waiting|used|gone`, or `&invite=lost` (every wait fails as a dropped connection).
- **Scan a QR.** The shot's browser has Chromium's fake camera, so the button is there and its window shows the fake picture; a browser without a camera has no button.

The screen, the group, the dialog with and without known origins, the new device waiting and on a lost link, the scan window:

```sh
npm run shot -- '/?signIn&lang=ru' .sign-in__card --size 390x844
npm run shot -- '/settings?lang=ru' --click '.settings-nav__item:has-text("Вход и устройства")' --wait '.sign-ins'
npm run shot -- '/settings?lang=ru&signInOn' --click '.settings-nav__item:has-text("Вход и устройства")' --wait '.sign-ins'
npm run shot -- '/settings?lang=ru&invites' --click '.settings-nav__item:has-text("Вход и устройства")' --click 'button:has-text("Пригласить устройство")' --wait '.invite__qr'
npm run shot -- '/settings?lang=ru&origins=0' --click '.settings-nav__item:has-text("Вход и устройства")' --click 'button:has-text("Пригласить устройство")' --wait '.invite__ask'
npm run shot -- '/invite?signIn&invite=waiting&lang=ru#fake' .sign-in__card --wait '.sign-in__digits' --size 390x844
npm run shot -- '/invite?signIn&invite=lost&lang=ru#fake' .sign-in__card --wait 'text=Связь прервалась' --size 390x844
npm run shot -- '/?signIn&lang=ru' 'dialog[open]' --click '.sign-in__wide:has-text("Сканировать")' --wait 1500 --size 390x844
```
