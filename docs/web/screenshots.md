# Page: screenshots and motion frame sheets

## Screenshots (`npm run shot`)

`?account=go` supplies an OpenCode Go account with all three windows, an expired Console key and a Console key without Go; `go-long` lengthens the healthy account's name. Open the expired row to see its warning and Replace key, then the replacement dialog. `?addAccount=opencode&addWay=go` opens the explicit Go add form. Fake Go keys containing `rejected` or `offline` exercise its error strip; replacement restores the three windows.

`/accounts?packages=marketplace` shows the Claude Code marketplace button, `?packages=marketplace-missing-cli` its missing-CLI error after a press, and the default its registered check mark. The tooltip has copyable commands. Combine with `account=codex-only` to check that neither the account page nor `/p/DEMO?pkg=1&add=linear@even-keel&packages=marketplace` asks a Codex-only installation to register a Claude marketplace.

`?header=sessionAccounts` supplies Claude and Codex accounts with the same e-mail and distinct names, with ABC-5 running on Codex by e-mail. Open ABC-5's session list, its session record and its chat to check account pills. Suffixes `-long`, `-missing` and `-empty` exercise a long OpenAI name, a missing Codex account and a session without an account.

`?account=connections` supplies every connection of every agent at once (BTN-576): Claude Max and Pro, an Anthropic key, ChatGPT Plus, Pro without five hours and Free with a month, OpenAI keys without credits (the problem band's paths), two Zen folders, OpenCode on ChatGPT, on Copilot, on both keys and on an OpenRouter key, and both Copilot sign-ins. Use it for the agent cards and connection groups on `/accounts` and in the drawer.

`?account=copilot-out` supplies a Copilot folder whose CLI explicitly reports no sign-in, beside a working token folder. Use it on `/accounts` to check the copyable sh sign-in command in the problem band; `copilot-out-cmd` supplies the Windows cmd command. `copilot-unknown` shows "Could not check" with launches allowed, including the mobile row; `copilot` shows the signed-in state.

`?account=opencodeCopilot` supplies an OpenCode folder holding only Copilot (with a monthly allowance) and a mixed Copilot/API-key folder. Shared settings select the former so `/setup?step=agent` and the project wizard show it as unsupported. Use it to check the accounts page/drawer, disabled account choices and the OpenCode add dialog without changing a real sign-in.

`?account=overage|overage-long|overage-permitted` supplies Claude using extra usage, a working Codex account with an exhausted window and 12.4 ChatGPT credits, an idle OpenCode account sharing credits, Copilot with extra usage disabled, and accounts with no extra-usage source. The long variant lengthens the active account name; the permitted variant enables Copilot additional usage. Use on `/accounts` or `/p/ABC` (open the account drawer), with `lang=ru` for translated narrow rows. Available paid usage adds `OverageWarning`, a shared warning Band with the provider spending-settings action and a keyboard/touch-accessible policy tip. Its controls do not toggle the account row menu.

`?account=mixup` supplies the sign-in mix-ups of BTN-528: a folder named after another account than the one in it, a second folder of the global account, and two signed-out folders, one with its last e-mail and one without. Use it on `/accounts` for the problem band and the rows.

`?account=model-weeks` supplies the models' own weeks of BTN-805: Max with five hours, the week and a spent Fable week without a reset, a verified Ultra with the week and Fable, a Team seat with five hours and Fable with a reset, and Pro whose answer listed no model week. Use it on `/accounts` and in the drawer of `/p/ABC`.

`?models=many` gives OpenCode an OpenRouter-sized catalogue of 323 models and sets three model prompts whose matches list a few, fold 312 behind "312 more" and count them all (BTN-858). Use it with `account=connections` on `/settings`, "Providers and models"; a narrow screen opens the group menu first (`--click 'button:has-text("Chain") >> nth=0'`).

Header account fixtures on `/p/ABC`: `?header=one|two|three|long|tokens|stale` show inherited accounts, project overrides, a pinned session over changed project settings, 40-character names, a token-only account and an old reading. Combine with `lang=ru`, `chain=paused`, `chain=close` or a light screenshot. The fixtures call the server's selector; account choice is not duplicated in the page.

`?chain=modelWeek` gives the chain a task held by a model's own week (BTN-816) with a reset, `?chain=modelWeekUnknown` one without: the chip names the wait and the line under it the model and the reset, or says that the reset time is not known. Use them on `/p/ABC` and on a home card.

`scripts/shot.ts` is the cheap way for a session to look at the page: a Playwright MCP step returns the page's whole accessibility tree into the context, the script returns a few lines and the PNGs of the elements asked for, read only when needed. One run is ~4 s.

```sh
npm run shot -- '?chain=ask&card=empty' .cards 'dialog[open]' --click '.card__key >> nth=0' --size 390x844
```

- The first argument starting with `?`, `/` or `#` is the route; it opens on a `dev:fake` server the script starts in-process on a free port (no port 5173, nothing left running), or on `--url <base>` (`http://localhost:4747` — the service).
- Every other argument is a selector: it is waited for (5 s), and its first match is shot alone into `.temp/shot/<name>/<n>-<selector>.png`; without selectors, the viewport into `page.png` (`--full` for the whole page). `<name>` is the route as a slug or `--name`; the folder is emptied on each run.
- Steps run in the order given, before the shots: `--click <sel>`, `--hover <sel>`, `--press <key>`, `--fill <sel>=<text>`, `--wait <sel|ms>`; then `--settle` ms (500). `--fill` splits at the first `=`, so its selector cannot hold one (`nth=1`, `[type=text]`): use `:nth-child()` or a class. A step's selector takes the first match on the whole page: a portalled dialog comes after the page, so scope it (`dialog button[type=submit]`).
- From Git Bash a route starting with `/` becomes a Windows path (`C:/Program Files/Git/tools`): run with `MSYS_NO_PATHCONV=1`, or from PowerShell.
- Dark theme, 1280×800 by default: `--light` (the system's theme), `--theme <system|light|dark>` (the page's own choice, written into the browser before the load; without it the page follows the system), `--size WxH`; `--reduced-motion` emulates `prefers-reduced-motion: reduce`. CSS animations are finished for the shot (`animations: 'disabled'`); motion is the frame sheet below.
- The report per selector: the match count, the box, and three lists of hints, each capped at `--limit` (8): `spill` — content wider or taller than a box with `overflow: visible` (the deepest such box), `cut` — content clipped by `hidden`/`clip`, marked when it is an ellipsis, `overlap` — in-flow siblings whose boxes cross. SVG shapes, boxes of 1 px or less and 2 px of slack are ignored. A hint is not a defect by itself (a stretched hit area spills by design): the picture decides.
- `--eval <js>` prints an expression's value from the page (a computed colour, a width); `--no-image` gives only the report.
- Exit code 1 when a selector is not found or the page logged an error (both printed), 2 when a step or the launch failed.
- The browser is only Playwright's headless shell (`npx playwright install chromium-headless-shell` after a Playwright bump). Never the installed Chrome: on Windows a fresh Chrome profile checks for a blank OS password with `LogonUser`, each launch is a failed logon (Security 4625 from `chrome.exe`), and a few runs lock the account and the service with it. The page side is `scripts/shot.page.js`, plain JS as an init script: tsx would wrap functions passed to `evaluate` in an undefined `__name`.

## Motion frame sheets (BTN-95)

An animation is checked by eye on one sheet of captioned frames, not frame by frame. Everything runs in one `browser_run_code_unsafe` call, without new dependencies.

- The state comes from `npm run dev:fake` (the table above), in the dark theme. For motion that a page timer starts (`?chain=close`), `page.clock.install()` goes before `goto` and `page.clock.runFor(ms)` moves time on: the page's timers then stand still and do not clear the marks while frames are taken.
- CSS animations and transitions: once the motion has started, `document.getAnimations().forEach((a) => a.pause())`, then for each moment set `a.currentTime = t` on all of them — one clock for the whole motion, `--beat` delays included. Moments: the start, quarters, the end, keyframe peaks.
- JS motion (`Typed`, `IdlePanel`, `Flight`): a series at an even step of 50–100 ms from its start.
- Each frame is captioned with its time from the start in ms and, per animation, `animationName` (`transitionProperty` for a transition, the beat or the text for JS) and `getComputedTiming().progress` in %.
- A frame is a `page.screenshot({ clip })` around the element, not the whole screen. The sheet is a new page (`page.context().newPage()`) with a grid of `img` from data URLs and their captions, taken with one `screenshot({ fullPage: true })` into `.temp/motion/<animation>/sheet.png`.
- Reduced motion: `page.emulateMedia({ reducedMotion: 'reduce' })`, then the `getAnimations()` with `playState === 'running'` — each one left has a reason (a loader slowed to 3 s) or is a defect.
