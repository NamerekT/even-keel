# The README badge

A project can show its chain in its README the way a CI badge shows a build: an SVG with the tasks being worked on,
the chain's queue, the milestone and a few numbers from the stats. The service builds the state and pushes it to a
Cloudflare Worker (BTN-916), the Worker stores the last state and draws it on every request. Nothing reaches the PC from
outside: the README's `<img>` hits the Worker, never the service.

The code is in `src/badge/`; the service's wiring is `src/service/badge.ts` (`wireBadges`).

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
(`badgeStateOf` in `src/badge/collect.ts`). A task's tracker title never leaves the service: only `titleEn`, the English
title of BTN-918; without it the badge shows the key alone.

### The action text

`badgeActionOf` (`src/badge/action.ts`) decides what a tool call says, at the transcript's parse
(`FeedLine.badge` in `src/sessions/transcript.ts`):

- file tools — the path inside the repository; a path outside it shows only the tool;
- `Bash`, `PowerShell`, `Agent`, `Task` — the call's own `description`; a bare command shows only the tool;
- `Skill` — the skill's name;
- an MCP call or any other tool — the tool alone (for MCP, the tool's part of the name).

The text is cut to 60 characters. A line of an agent whose parser sets no `badge` (Codex and the rest) shows the first
word of its feed line, the tool.

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

## Setting and secret

- `badge` — a project setting (`docs/settings.md`): `null` — no badge, else `{ on, url, slug, fields }`. Read only for
  now: the page's form does not write it until the badge's dialog (BTN-917); set it by hand through `config-import`.
  A bad value is `config.badge`; it applies live.
- `EVEN_KEEL_BADGE_SECRET` in `.env` — the Worker's push secret.

## Preview

`GET /api/projects/<id>/badge.svg?theme=dark|light` draws the badge of the service's current state (anything but
`light` is dark), `no-store`; an unknown project is 404. It does not need the badge to be on.
