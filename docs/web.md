# Page, language, config

Reference for sessions: the interface, translation, config reloading and fake states for layout work.

## Interface

- React + Vite in `web/`, built into `dist/web`, which the server serves; for client routes the server answers `index.html`.
- The client takes state types from `src/state.ts` — only types there, no `node:*`.
- `npm run dev:web` — Vite with a `/api` proxy to `EVEN_KEEL_URL` (`:4747` by default).
- The task card (`web/src/pages/TaskCard.tsx`, loaded lazily together with `react-markdown`): a task title in the chain and in the backlog opens it, while the number still opens the session panel. An open card is the `?task=<id>` parameter in the address, so "back" on a phone closes it; links to other tasks inside the card replace the parameter without piling up history. Markdown links leading inside the tracker are text, and those with a task number open its card.
- Folding on the project page (`web/src/pages/ChainList.tsx`): the divider line itself is the button. A hidden milestone is a dashed line that reveals it; the header of a revealed one folds it together with those after it; the archive has a line that loads the next page and a line that folds it. Milestones up to the first one with open tasks cannot be folded (`fixed` in `web/src/ui/milestones.ts`); a chain without milestones has no lines at all, except the archive's.
- A backlog task on its way into the chain (`web/src/pages/useArrival.ts`): while its "Move to Todo" button is pointed at or pressed, a ghost block stands where it would land (`ProjectOrder.landing` from the service, `landingIndex` puts it ahead of the locked blockers of the task it precedes) and the page scrolls to it, revealing a folded milestone; once the task is in the chain a copy of the backlog row flies to its block (`Flight.tsx`) and the block is marked for a moment. On a narrow screen (≤760 px) and with reduced motion there is no flight: the narrow screen closes the panel instead.
- From 1200 px the project page always keeps the side column, so the chain does not change width when a panel opens; with no panel open it holds `IdlePanel` — an ASCII sailboat (`web/src/ui/voyage.ts`), a meme and a hint. Below 1200 px nothing is reserved.
- The meme (`web/src/ui/memes.ts`): `momentsOf` reads the page's situation — no open tasks, empty backlog, chain stopped, running, unattended or waiting out a limit, a task with a question or skipped, a task on its 3rd session, a checkpoint handoff, over $1000 in the strip's 30 days — and half the draws take one of these moments' lines (`t.project.idle.moments`); the rest take a general line (`t.project.idle.memes`) or `drive`, the one line that switches the boat to the old picture crawling over the swell as over land. A moment's line is redrawn once the moment ends. The boat's hull never tilts — a two-row hull breaks into steps in ASCII; only the rig leans with the swell and the sway.
- The tab badge (`web/src/layout/tabBadge.ts`): a red dot — the status panel has an error (including a lost connection to the service), a yellow one — sessions are waiting for a reply; their count is in the title, `(2) Even Keel`. The badge without a dot is `web/public/favicon.svg`, and the dot is drawn onto it in a data URL.
- The content column is `--column` in `web/src/styles.css`: 94 % of the window, the header and the banners use the same variable.
- What the page is busy with: every request except polling goes through `activity.track` (`web/src/live/activity.ts`) and shows the bar at the top of the window (`ActivityBar`). `useCommand` marks the pressed button `aria-busy` for the duration of its command, so a new command button needs nothing for its spinner. A command the service accepts at once and carries out later (`chain/restart`) keeps its button busy with `useHold` until the state changes; a block that reloads with its previous data on screen sets `aria-busy` on itself and is dimmed.
- The page installs as an app (`web/public/manifest.webmanifest`, `icon-*.png` icons are renders of `favicon.svg`, the `maskable` one has the mark with a margin for cropping). There is no service worker: the service serves a fresh `dist/web` anyway. The install button in Chrome appears only in a secure context: `localhost` or HTTPS; not on a bare `http://<IP>`.

## Language (BTN-57, `src/language.ts`: `en`, `ru`)

- `language` in `even-keel.config.json` is the page language (`null` or no key — the browser language, English if it is unfamiliar), `promptLanguage` is the language of session prompts (absent — `language`, then English; `src/chain/prompts.ts`).
- The page translates its own chrome (`web/src/i18n/`, `ru.ts` is the source of the type, `en.ts` equals it) and server messages (BTN-62): pause reasons, cleanup, config, sign-in and command errors arrive as a code with values (`{ code, params, detail, cause, items }`, `src/notice/notice.ts`); the English text and the list of codes are in `src/notice/en.ts`, the Russian in `web/src/i18n/notices-ru.ts`, and the page builds the text with `say()`. A new code is an entry in both files; the type checks that the sets are equal.
- The service log is in English; git and CLI output (`detail`) and strings saved before BTN-62 (the old `state/chain.json`) are shown as is. Data (transcripts, labels, tasks) is not translated.

## Live config (`src/config-file.ts`)

The service rereads `even-keel.config.json` on the fly: `parallel`, `chain`, `brief`, `model`, `modelPrompts`, `stats`, `language`, `promptLanguage` and `hiddenSkills` apply immediately, while `host`, `port`, `projects`, `context`, `tracker` apply after a restart (the log says what is waiting). A broken file — the last valid one keeps working, the error goes to the log and to a banner on the page (`ConfigBanner`).

## Fake states (`npm run dev:fake`)

Layout work on a fake state, without a tracker or sessions. The fake history starts in November 2023 and has several projects and folders without a project.

| Parameter | What it shows |
| --- | --- |
| `?link=stale\|connecting` | connection states |
| `?chain=idle` | no active chain, to check starting one |
| `?parallel=2` | two chains at once: DEMO, taken from the queue, runs next to ABC |
| `?chain=limit` | the chain is waiting for the limit reset |
| `?chain=skip` | a skipped task and a session postponed by a blocker |
| `?chain=backlog` | blockers from Backlog under a lock in front of the held task (milestone v0.2) |
| `?chain=restart` | a session ended on a limit and lost Remote Control, the "New session" button |
| `?chain=close` | the current task closes every 10 s and the chain takes the next one |
| `?chain=checkpoint` | two checkpoint handoffs on the current task |
| `?chain=leftover` | cleanup warnings after Done |
| `?usage=unread\|off\|waiting` | `/usage` polling states |
| `?config=broken` | the broken config banner |
| `?mcp=missing` | the banner "brief is off, and sessions don't see the tracker MCP servers" |
| `?account=out\|expired\|login\|failed\|unknown` | states of the active Claude account; the `fail` code in the sign-in field is a failed sign-in |
| `?account=pending` | the new configuration is waiting for the account's sessions to finish |
| `?account=removing` | the folder is waiting for sessions to finish so it can be removed |
| `?account=vscode-chats` | VS Code cannot be switched because of open chats |
| `?account=vscode-broken` | VS Code `settings.json` is unreadable |
| `?stats=off\|error\|empty` | stats are off, the database is unavailable, there is no data — on `/stats` and in the project page strip |
| `?rules=empty\|thin` | no rule changes, "Before and after" with a small sample |
| `?tools=bloated\|empty` | `/tools`: the last session with claude.ai skills, a failed MCP server and an account mismatch; without transcripts. Projects on an odd letter (`ABC`, `OPS`) differ slightly in settings — for "Only differences" |
| `?card=empty\|none` | a task card without description, labels, relations and comments; the tracker returns no card. "Move to Todo" (in the card and in the backlog panel) moves the task from the backlog into the chain in the fake, to its `landing` place: ABC-18 into v0.2, ABC-19 into the folded v0.3, ABC-20 to the end |
| `?lang=en\|ru` | the page language from the config (without it — the browser language) |
| `?delay=<ms>` | answers (stats, tools, card, session) take that long instead of 0.3 s, and "New session" swaps the session that much later — for skeletons, dimming and the busy button |
