# The README badge

A project can show its chain in its README the way a CI badge shows a build: an SVG with the tasks being worked on,
the chain's queue, the milestone and a few numbers from the stats. The service builds the state and pushes it to a
Cloudflare Worker (BTN-916), the Worker stores the last state and draws it on every request. Nothing reaches the PC from
outside: the README's `<img>` hits the Worker, never the service.

The code is in `src/badge/`; the service's wiring is `src/service/badge.ts` (`wireBadges`); the Worker is
`deploy/badge/` ("The Worker" below).

## The state: contract v1

`BadgeState` in `src/badge/model.ts` is what the service pushes and what `renderBadge` draws; `BADGE_VERSION` is `1`.

- `v`, `at` (ISO time of the push), `project` (`key`, `name`).
- `active` — the tasks with a live session: `key`, `titleEn`, `agent`, `model`, `startedAt`, `state` (`working` |
  `waiting`), `action` (`{ tool, text }`), `context` (whole percents).
- `chain` — `state` (`running` | `paused` | `stopped` | `idle`), `next` (the task the chain takes next, `null` — none),
  `tasks` (chips: the last done ones, the working, the waiting and the queue).
- `milestone` — `{ name, done, left }` or `null`.
- `stats` — `sessions`, `medianCost`, `medianMinutes`.

The project picks its fields (`BADGE_FIELDS`); a field not picked leaves **no key**, never `null`
(`badgeStateOf` in `src/badge/collect.ts`). A task's tracker title never reaches the Worker: only `titleEn`, the English
title (`translate.ts`); without it the badge shows the key alone.

### The action text

`badgeActionOf` (`src/badge/action.ts`) decides what a tool call says, at the transcript's parse
(`FeedLine.badge` in `src/sessions/transcript.ts`):

- file tools — the path inside the repository; a path outside it shows only the tool;
- `Bash`, `PowerShell`, `Agent`, `Task` — the call's own `description`; a bare command shows only the tool;
- `Skill` — the skill's name;
- an MCP call or any other tool — the tool alone (for MCP, the tool's part of the name).

The text is cut to 60 characters. A line of an agent whose parser sets no `badge` (Codex and the rest) shows the first
word of its feed line, the tool.

## The filter of private data

The badge is the one place where the chain's state leaves the machine for a public picture, and two of its texts are
free: a command's `description` (the agent writes it) and `titleEn` (a model translates it). `stateOf` in
`src/service/badge.ts` — the one state the push, the preview and "Check" all take — passes it through `withoutPrivate`
(`src/badge/privacy.ts`, BTN-931), so the preview shows exactly what would be pushed. A new free text of the state gets a
`PrivacyField` and a branch there.

**Layer 1, the service's own strings** (`bannedFor`, `src/service/badge-private.ts`), built anew for each state, so a
changed setting applies at the next push:

- the agents' account folders, their names, e-mails and organisations, the apps' accounts and folders, the pool entries;
- the machine's user and name, the user's folder of the home path and of the projects' paths (a service running as
  another user still has it), `CLAUDE_CONFIG_DIR` and `CODEX_HOME`;
- every tracker and CI profile: its name, login and each field that is not a secret, the tracker link templates,
  `EVEN_KEEL_HOST` and `allowedHosts` — an address also gives its host, a `*.ts.net` host its tailnet;
- `user.name` and `user.email` of the service's git and of the project's repository (`git config --get`, read in the
  background at most every 15 min) — a name also by its words, an e-mail also by its part before `@`;
- the key, name, task prefix and tracker project of every other project.

`bannedOf` lowers the case and leaves out strings shorter than three characters, a short list of common words
(`COMMON`: an account folder named `work` must not empty the badge) and the badge's own project. A string counts only
where it stands as a word, in any case: the key `NAM` does not hide "name".

**Layer 2, shapes** (`looksPrivate`):

- secrets by prefix (`sk-`, `gh?_`, `github_pat_`, `glpat-`, `xox?-`, `AKIA`, `eyJ`), `name=value` and
  `password: …`-like pairs, `Bearer …`;
- any URL, e-mails, phone numbers (`+` and seven digits, or ten digits; dates and times are not counted), IPv4, IPv6 and
  MAC addresses, `localhost`, hosts;
- absolute paths: a drive, a UNC share, `~/`, a slash-led path of two segments or more.

What the tests pin down: a four-part number (`1.2.3.4`) is an IP address, a three-part version is not; a dotted name
is a host unless its last part is a file ending of `FILE_ENDINGS` or it follows a `/` — so `src/x.ts` and `x.ts` pass
and `state.tasks` or `example.io` do not; `/stats` passes, `/home/john/x` does not; `vitest@3.2.1` and
`tasks@even-keel` are not e-mails.

**A caught text is left out, never masked**: a title leaves no `titleEn` key, an action keeps only its tool
(`{ tool, text: tool }`), and an action whose tool itself is caught becomes `null`. Not sure — not published: an
exception inside the filter drops the text, and until the repository's git identity is first read every free text is
dropped. The log gets one line per project, field and layer for the service's lifetime, without the text:
`badge: ABC: the action text is left out, it looks like a secret, a contact, an address or a path (layer 2)`.

What it does not catch: a person's, a company's or a client's name the service does not know. Only the translation
prompt asks for those to be replaced, and only in the title; an action's description goes as the agent wrote it. The
project's own key and name, the milestone's name and the agent's and model's names are not filtered: the project
picks those fields itself.

## Modes

`badgeMode` (`src/badge/render.ts`) by the state's age and the chain:

| Mode | When | Drawing |
| --- | --- | --- |
| `live` | the chain runs, the state ≤ 5 min old | animated |
| `stale` | the chain runs, 5–60 min old | animated, the dot grey |
| `offline` | older than 60 min | still, "OFFLINE · last seen …", the last tasks frozen |
| `still` | the chain is paused, stopped or idle | still |
| `unpublished` | no state yet | a placeholder |

## Drawing

`renderBadge` returns an SVG document 840 px wide: no script, no outside resource. The layout follows the task's mockups
(BTN-915's attachments): a header with the state, what the chain does ("<project> is being built right now", "· N tasks
at once", "the agent asked the maintainer…") and the age of the push; one task in work gets a large title with
"agent · model · started N min ago" under it, several share rows with that line on the right; the action bar is the
tool's icon, the action in the agent's colour (yellow for Claude, blue for the rest), a blinking cursor, the context
fill with a glowing edge and `context N%`; a waiting task has a dashed "waiting for the maintainer's answer" bar
instead. The chain's chips name a task of the project by its number (`895`), one of another project by its key; the
stats are one line of small print on the right. The colours are the page's tokens
from `web/src/styles.css`, copied into `src/badge/theme.ts` for the dark and the light theme. Animations are CSS in the
SVG's own `<style>`, off under `prefers-reduced-motion`. `<title>` and `aria-label` carry the full text; a cut title is
cut by the fonts' width table, the same one the browser draws by.

### Fonts

Inter 4.1 (400 and 600) and JetBrains Mono 2.304, subset to printable ASCII and a few signs, embedded as WOFF2 in
`src/badge/fonts.generated.ts` with their glyph widths; an unknown character counts 0.72 em. Their licenses (SIL OFL)
are in `src/badge/fonts/`. To rebuild (fontTools with Brotli):

```sh
python scripts/badge-fonts.py <Inter-Regular.ttf> <Inter-SemiBold.ttf> <JetBrainsMono-Regular.ttf>
```

## Pushes

`BadgePusher` (`src/badge/push.ts`) posts the state to `<url>/push/<slug>` with `Authorization: Bearer <secret>`:

- a change goes at once, unless the last attempt was less than 2 min ago (`BADGE_MIN_GAP_MS`: the free KV takes 1000
  writes a day) — then on the first tick after the gap;
- without a change, a pulse every 15 min (`BADGE_PULSE_MS`), so the Worker sees the service alive;
- a badge turned off or removed gets one last state with `chain.state: 'stopped'`;
- a failure is logged once per reason and retried after the same 2 min; without the secret — one log line, no push.

The service ticks on a state change (at most every 2 s) and every 30 s.

## Stats

`stats` are Tally's numbers over the last 30 local days, all scope, tests included (`src/badge/stats.ts`): the session
count, the median cost of done tasks at API list prices (`priceEstimate`, else `cost`) and their median active minutes.
They are read in the background at most every 15 min; with Tally off the badge has none.

## English titles

`BadgeTranslations` (`src/badge/translate.ts`, BTN-918) translates only the current tasks of an enabled badge whose
fields include `title`. No task or an empty title means no request. Preview and Check can read an existing translation
with publishing off, but do not ask for a new one. Requests run in the background: until a title is ready, only the
task's key is available. The next push follows the usual two-minute minimum gap.

It uses the classifier's live `TALLY_LLM_URL`, `TALLY_LLM_KEY` and `TALLY_LLM_MODEL` (`llmSettings`,
`tally/src/classify.ts`): `POST <url>/chat/completions`, bearer key, `temperature: 0`, the default model
`google-gemini-3.1-flash-lite`. LiteLLM owns model fallbacks. The system prompt asks for concise English within 90
characters and unchanged code and file names, and to replace names of people, companies and clients, addresses and
e-mails with general words — or to answer `NONE` where the title makes no sense without them (BTN-931). `NONE` is kept
as an empty title: the badge shows the key alone and the title is not asked again, even after a change of the LLM
settings. The answer then passes the filter above like any free text. The user message is **only the title**, never the
task's description, comments or question. Timeout: three minutes, like the classifier. The answer loses Markdown, HTML tags, controls,
formatting characters, surrounding quotes and extra whitespace, then is cut to 90 Unicode characters.

Database step 45 adds `badge_translations`: a tracker source (kind, profile and tracker project; built-in trackers use
the project GUID), task id and SHA-256 of the original title. An in-flight request is shared by all badge consumers.
Success stays cached across restarts and changes of model or credentials; a changed title uses another cache key.
An attempt is saved **before** the request: missing settings, failure, an empty answer or a restart during a request
leave no `titleEn` and delay another attempt for at least 30 minutes. Each failure reason is logged once per service
lifetime and set of settings, without the response body, original title or credentials.

A live change of the URL, key or model (BTN-955) lifts that delay for every failed title, in memory and in the table
(`attempted_at = 0`), and lets each reason be logged again; a request still in flight under the old settings starts no
delay either. Ready titles are kept. The change is seen by the running service only: settings edited while it is down
leave the saved delay to run out.

`badge_translation_spend` retains the usage as Tally message rows, even for an unusable title. The next collector run
reads it through the state database's owner and writes `messages` (`entrypoint: badge-translate`, account `litellm`,
project and folder as for the classifier). Message ids make replay idempotent after a failed collection; the retained
ledger also lets translation work while Tally is off. The classifier's free Gemini/Gemma prices are 0, tokens visible.
Unit tests cover the request, cache, restart, retries, cleanup, selection and spend replay; the actual LiteLLM request
and free-tier accounting await BTN-919 ([unverified](unverified/page.md#the-badges-english-titles-btn-918)).

## Setting and secret

- `badge` — a project setting (`docs/settings.md`): `null` — no badge, else `{ on, url, slug, fields }`. The project
  form leaves it alone; the badge's dialog writes it (below), `config-import` by hand. A bad value is `config.badge`;
  it applies live.
- `EVEN_KEEL_BADGE_SECRET` in `.env` — the Worker's push secret, one for all projects.

## The dialog

Project settings → Repository has a line "README badge" after the Repository card (`BadgeButton.tsx`, the look of
"Project packages"): off, no address yet, or `published: <host>/<slug>`. It opens `?badge=1` over the project page,
the settings tab kept (`BadgeDialog.tsx`, lazy). Four cards, each change written at once — no "Save" of its own:

- **Where to publish** — the switch `on`, the Worker address (`url`) and its name on the Worker (`slug`, the project
  key in lower case until one is given, `defaultSlug`), written on blur or Enter; the push secret through
  `secrets/set` (the page sees only whether it is set; one from outside `.env` disables the field); a link to
  `deploy/badge/README.md` on GitHub. "Check" pushes the project's current state to the address and name in the
  fields, saved or not, then reads the picture back (`checkBadge`, `src/badge/check.ts`). Its answer is a band under
  the button: `badge.checked`, or `badge.url`, `badge.slug`, `badge.noSecret`, `badge.unreachable` (the network error
  only in the log), `badge.refused` (401), `badge.notWorker` (404), `badge.rejected` (400), `badge.pushStatus`, then
  for the picture `badge.imageStatus`, `badge.notSvg`.
- **What to show** — eight switches over `fields` (`BADGE_GROUPS` in `badgeParts.ts`): tasks in work and the action
  (`agent`, `model`, `time`, `action` together), context, the chain, the milestone, sessions, median cost, median time,
  English titles. The dialog always writes the full list.
- **Preview** — the picture from the preview route above, dark or light, fetched again as the state moves but at most
  every 5 s, and at once when a field changes.
- **For the README** — the link a press on the badge leads to, guessed from the project's remotes (`releasesLink`:
  a GitHub remote's releases first, then GitLab's `/-/releases`, then any other hosted one), editable and not saved;
  under it the snippet (`badgeMarkdown`): a `<picture>` with the light theme for a light reader and the dark one
  otherwise, inside `<a>` when the link is not empty. Without an address and a name only a line saying so.

The commands: `project/badge` `{ project, badge }` — `badge.url`/`badge.slug` for a bad address or name, else
`ConfigStore.saveBadge` (`withBadge` in `src/config-form.ts`) and a push tick; the query `project/badge/check`
`{ project, url, slug }` → `{ ok, notice }`. In `dev:fake`: `?badgeState=filled`, `?badgeCheck=refused|unreachable`
(`docs/web/fake-states.md`).

## Preview

`GET /api/projects/<id>/badge.svg?theme=dark|light` draws the badge of the service's current state (anything but
`light` is dark), `no-store`; an unknown project is 404. It does not need the badge to be on.

## The Worker

`deploy/badge/` is the Cloudflare Worker a user deploys for their badges (BTN-916): `src/worker.ts` (`handle`), KV bound
as `BADGE`, the secret `BADGE_SECRET`. How to deploy and connect it is its own `README.md`, written for users.

- `POST /push/<slug>` — the bearer secret, compared by SHA-256 digests; none set on the Worker refuses every push (401).
  The body (at most 64 KB) must be a state of version 1: `parseBadgeState` (`src/state.ts`) checks the type of every key
  `renderBadge` reads, a left-out field is absent, never `null` (except `milestone` and `action`). 400 otherwise, 204
  and one KV write on success.
- `GET /<slug>.svg?theme=light` — `renderBadge` with `now` taken at the request, so the age and the modes are counted
  when the picture is shown; a missing or unreadable stored value draws the `unpublished` placeholder.
  `Cache-Control: no-cache, max-age=0`, a strong `ETag` of the SVG's SHA-256, 304 on a match (`W/` and `*` too).
- The slug follows the service's rule (`src/badge/settings.ts`); any other path or method is 404.

### Kept apart from the package

The folder has its own `package.json` (`even-keel-badge-worker`: wrangler, vitest, typescript), is not in the root
`files`, and the root dependencies have no wrangler. The Deploy to Cloudflare button takes a subfolder URL as the root of
the user's new repository and fails a build that reaches outside it (Cloudflare's deploy-button docs, read 2026-11-09),
so the Worker cannot import `src/badge/`: it takes the drawing from the npm package `even-keel-badge` (BTN-941).

- **The package** is `packages/badge/`: `package.json`, `tsconfig.json` and `build.mjs`, no source of its own. Its entry
  is `src/badge/drawing.ts` (`renderBadge`, `badgeMode`, `BADGE_VERSION` and the state's types); `build.mjs` compiles it
  with what it imports into `packages/badge/dist` and copies the fonts' licenses (`dist/fonts/`) and `LICENSE`. `files`
  is `dist` alone, so `push.ts`, `collect.ts`, `settings.ts`, `action.ts`, `stats.ts` and the tests never ship;
  `src/badge/drawing.test.ts` fails if the entry reaches a module of the service or any import outside `src/badge/`.
  `npm pack --dry-run` in the folder builds and lists it.
- **Its version** is Even Keel's: the file says `0.0.0`, and `publish.yml` sets the tag's version before publishing it
  with the release (`docs/releases.md`, "Publishing to npm"). A change of the drawing reaches deployed Workers only
  with a release.
- **The Worker** depends on `even-keel-badge@latest` and keeps no lock (`/deploy/badge/package-lock.json` is in the
  root `.gitignore`): Cloudflare's build installs the latest release each time, and a lock could only name the release
  before the one whose tag publishes the package. Between a release's push to `main` and the end of its `Publish` run
  the button would install the previous version.
- **In this repository** the Worker sees the current `src/badge/`, not the published package: the root `vitest.config.ts`
  aliases `even-keel-badge` to `src/badge/drawing.ts`, and `npm run typecheck` checks the folder through
  `packages/badge/worker.tsconfig.json` (its own `tsconfig.json` — DOM types, no Node — plus that one `paths` entry).
  The folder's own `tsconfig.json` has no `paths`: a user's clone resolves the package from `node_modules`.

The Worker's tests (`deploy/badge/src/worker.test.ts`, a fake KV) run in the root `npm test`. `npx wrangler deploy
--dry-run` in the folder bundles it (66 KiB, 2026-11-09; again 2026-11-09 with the packed `even-keel-badge` installed
from its tarball, 66.53 KiB), and `wrangler dev` served pushes from `postBadge` live (`docs/verified/page.md`).
