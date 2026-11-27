# Page: screenshots and motion frame sheets

## Screenshots (`npm run shot`)

`scripts/shot.ts` is the cheap way for a session to look at the page: a Playwright MCP step returns the page's whole accessibility tree into the context, the script returns a few lines and the PNGs of the elements asked for, read only when needed. One run is ~4 s. The states to shoot are the `dev:fake` parameters of `fake-states.md`. A task card over the first chain on a phone:

```sh
npm run shot -- '?chain=ask&card=empty' .cards 'dialog[open]' --click '.card__key >> nth=0' --size 390x844
```

- The first argument starting with `?`, `/` or `#` is the route; it opens on a `dev:fake` server the script starts in-process on a free port (no port 5173, nothing left running), or on `--url <base>` (`http://localhost:4747` — the service).
- Every other argument is a selector: it is waited for (5 s), and its first match is shot alone into `.temp/shot/<name>/<n>-<selector>.png`; without selectors, the viewport into `page.png` (`--full` for the whole page). `<name>` is the route as a slug or `--name`; the folder is emptied on each run, and the folders of other names older than an hour go with it, so never `rm -rf .temp/shot/*`: the CLI's removal check holds such a command for a person, and in a chain session that question expires unanswered (EKR-140).
- Steps run in the order given, before the shots:
  - `--click <sel>`, `--context <sel>` (a right click: the menu of the agent's last message in a chat, `.message-menu`), `--hover <sel>`, `--press <key>`;
  - `--fill <sel>=<text>`, `--upload <sel>=<path>[,<path>…]` (files from the checkout into a file input, hidden ones too: `.chat__attach input`). Both split at the first `=`, so their selector cannot hold one (`nth=1`, `[type=text]`): use `:nth-child()` or a class;
  - `--wait <sel|ms>`, `--wheel <px>` (the mouse wheel where the pointer is: `--hover` a scrolling box first, as the task card's side panel);
  - `--drag <sel>` presses the mouse on the element and never lets go: a `--hover` after it carries the element, so the shot is mid-drag (the chain's drop preview: `'/p/ABC?chain=lanes' --drag '[data-block="ABC-9"]' --hover '[data-block="ABC-5"]'`); `--drop` lets the mouse go (`?chain=long&order=refused` for a refused drop);
  - then `--settle` ms (500).

  A step's selector takes the first match on the whole page: a portalled dialog comes after the page, so scope it (`dialog button[type=submit]`).
- From Git Bash a route starting with `/` becomes a Windows path (`C:/Program Files/Git/tools`): run with `MSYS_NO_PATHCONV=1`, or from PowerShell.
- Dark theme, 1280×800 by default: `--light` (the system's theme), `--theme <system|light|dark>` (the page's own choice, written into the browser before the load; without it the page follows the system), `--size WxH`; `--scale N` the device pixel ratio (2 for a retina shot, 4–5 to judge how a plaque's text is centred); `--reduced-motion` emulates `prefers-reduced-motion: reduce`; `--touch` a touch screen, so `(pointer: coarse)` matches as on a phone (the chat's Camera/Photos/Files sheet: `'/p/ABC#chats' --click '.chat-card >> nth=1' --click '.chat__attach' --size 390x844 --touch`). CSS animations are finished for the shot (`animations: 'disabled'`); motion is the frame sheet below.
- The report per selector: the match count, the box, and four lists of hints, each capped at `--limit` (8): `spill` — content wider or taller than a box with `overflow: visible` (the deepest such box), `cut` — content clipped by `hidden`/`clip`, marked when it is an ellipsis, `overlap` — in-flow siblings whose boxes cross, `double` — an element with a native `title` inside our tip's anchor (`.tipped`, `.panel__total`, `.help`) or holding one, so pointing at it opens two tips at once (EKR-146); a `Tipped` that is `off` (`data-off`, the tip of a disabled button) does not count. Unlike the other three, a `double` is always a defect. SVG shapes, boxes of 1 px or less and 2 px of slack are ignored. A hint is not a defect by itself (a stretched hit area spills by design): the picture decides.
- `--eval <js>` prints an expression's value from the page (a computed colour, a width); `--no-image` gives only the report. Evals run after the shots.
- The page has the clipboard granted, so a copy button's press reaches its check (`--click '.ui-code__button'`, BTN-1677) and `--eval "navigator.clipboard.readText()"` prints what it copied.
- Exit code 1 when a selector is not found or the page logged an error (both printed), 2 when a step or the launch failed.
- The browser is only Playwright's headless shell (`npx playwright install chromium-headless-shell` after a Playwright bump). Never the installed Chrome: on Windows a fresh Chrome profile checks for a blank OS password with `LogonUser`, each launch is a failed logon (Security 4625 from `chrome.exe`), and a few runs lock the account and the service with it. The page side is `scripts/shot.page.js`, plain JS as an init script: tsx would wrap functions passed to `evaluate` in an undefined `__name`.

## The guide's frames (`npm run guide-shots`, BTN-1748)

The pictures of `docs/guide/` are shot, never drawn by hand: each is a frame of the manifest `docs/guide/images/shots.json`, and `npm run guide-shots` shoots every frame (or `npm run guide-shots -- <id> …` the ones named) into `docs/guide/images/<id>.webp`. A page links one as `![What the frame shows](images/<id>.webp)`; GitHub and the docs site both render WebP.

```json
{ "frames": [
  { "id": "chain-rows", "route": "/p/ABC", "crop": { "x": 24, "y": 204, "width": 800, "height": 372 } },
  { "id": "machine-pins", "route": "/p/ABC?chain=pins", "steps": [{ "hover": ".block__pin" }, { "wait": "300" }], "width": 1024, "theme": "light" }
] }
```

- A frame: `id` (lower-case words joined by `-`, the file's name), `route` (a `dev:fake` route with its query, as `npm run shot` takes it), `steps` (each `{ "<kind>": "<arg>" }`, the kinds and arguments of `npm run shot`'s steps above: `click`, `context`, `hover`, `press`, `fill`, `upload`, `wait`, `wheel`, `drag`, `drop`), `selector` (the element shot alone; none — the viewport), `width` and `height` of the viewport (1280×800), `theme` (`dark`, or `light`), `scale` (the device pixel ratio, 1), `crop` (`{x, y, width, height}` in CSS pixels from the top left of the element or the viewport), `quality` (WebP, 0.9) and `settle` (ms after the steps, 500). An unknown key or a wrong value stops the run with the frame's id.
- The same machinery as `npm run shot` (`scripts/shot-browser.ts`, `scripts/shot-step.ts`): Playwright's headless shell and `dev:fake` in process. The encoder is the browser's own (`canvas.toDataURL('image/webp')`, `scripts/guide-shots.page.js`), no new dependency.
- A run without interface changes rewrites no file: the line says `same`, `changed` or `new` per frame. For that the frame is shot at a fixed moment (`page.clock.setFixedTime`), in UTC and `en-US`, with `Math.random` seeded, every animation and transition run to its end at once, subpixel text off (`--disable-lcd-text`: its fringes followed the page's layers, one run in a few differed), and only once two shots 300 ms apart match (late panels such as the milestone's stats). A frame whose page logs an error is not saved and the run exits 1.
- Only `dev:fake` data, so no real names reach a picture; its task titles are Russian, as the rest of the fake.
- `scripts/guide-shots-manifest.test.ts` holds the manifest and the guide together: every picture a guide page links under `images/` is a frame, every frame is linked from a page and has its file, and `docs/guide/images/` holds nothing else. A new frame is a manifest entry, a run with its id and a link in the same commit.
- The frames are shot again before each release (`docs/releases.md`, step 5).

## Motion frame sheets (BTN-95)

An animation is checked by eye on one sheet of captioned frames, not frame by frame. `npm run shot` finishes every animation, so the sheet is a one-off Playwright script in `.temp/motion/` on the checkout's own `playwright` package and a `dev:fake` server (`npm run dev:fake`), without new dependencies. Not the Playwright MCP: each of its steps returns the page's whole accessibility tree, and a sheet takes dozens.

- The state is a `dev:fake` parameter (`fake-states.md`), in the dark theme. For motion that a page timer starts (`?chain=close`), `page.clock.install()` goes before `goto` and `page.clock.runFor(ms)` moves time on: the page's timers then stand still and do not clear the marks while frames are taken.
- CSS animations and transitions: once the motion has started, `document.getAnimations().forEach((a) => a.pause())`, then for each moment set `a.currentTime = t` on all of them — one clock for the whole motion, `--beat` delays included. Moments: the start, quarters, the end, keyframe peaks.
- JS motion (`Typed`, `IdlePanel`, `Flight`): a series at an even step of 50–100 ms from its start.
- Each frame is captioned with its time from the start in ms and, per animation, `animationName` (`transitionProperty` for a transition, the beat or the text for JS) and `getComputedTiming().progress` in %.
- A frame is a `page.screenshot({ clip })` around the element, not the whole screen. The sheet is a new page (`page.context().newPage()`) with a grid of `img` from data URLs and their captions, taken with one `screenshot({ fullPage: true })` into `.temp/motion/<animation>/sheet.png`.
- Reduced motion: `page.emulateMedia({ reducedMotion: 'reduce' })`, then the `getAnimations()` with `playState === 'running'` — each one left has a reason (a loader slowed to 3 s) or is a defect.
