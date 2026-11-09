# The README badge's Worker

A Cloudflare Worker that keeps the last state Even Keel pushed for a project and draws it as an SVG for the project's
README. Even Keel pushes; the README's `<img>` reads the Worker. Nothing reaches your machine from outside, and the Worker
calls nothing itself. One Worker serves any number of projects, each under its own slug.

It is made for Cloudflare's free plan: KV is written only when Even Keel pushes — on a change, but at most once in 2
minutes per project, and a pulse every 15 minutes without one — and every view is one KV read. That is 96 writes a day for
a quiet project and at most 720 for one that changes all day; the free plan allows 1000 a day, so more than one busy
project on one Worker can run out of writes, and the badges then stay on their last pushed state until the next day.

## Deploy with the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/NamerekT/even-keel/tree/main/deploy/badge)

The button copies this folder (only this folder) into a new repository on your GitHub or GitLab account, creates the KV
namespace and deploys the Worker from it. It asks for `BADGE_SECRET`: any long random string, for example the output of
`openssl rand -hex 32`. Keep it: Even Keel needs the same value. The Worker's address is shown at the end, like
`https://even-keel-badge.<your-subdomain>.workers.dev`.

## Deploy by hand

With Node.js 24 and a Cloudflare account:

```sh
cd deploy/badge
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put BADGE_SECRET
```

The first `wrangler deploy` creates the KV namespace bound as `BADGE` and remembers it on later deploys. `wrangler
secret put` asks for the secret's value. `npm run dev` runs the Worker locally (put `BADGE_SECRET=...` into `.dev.vars`
first, as in `.dev.vars.example`).

## Connect Even Keel

- The secret goes into Even Keel's `.env` as `EVEN_KEEL_BADGE_SECRET=<the same string>`.
- The project's `badge` setting names the Worker and the project's slug: `{ "on": true, "url": "<the Worker's address>",
  "slug": "my-project" }`. The slug is lower-case letters, digits and dashes. Until the page has a dialog for it, set it
  through `npm run storage -- config-export` and `config-import`
  ([the reference](https://github.com/NamerekT/even-keel/blob/main/docs/guide/reference.md)).

Even Keel then pushes the project's state, and the picture is at `<the Worker's address>/<slug>.svg`:

```markdown
![Even Keel](https://even-keel-badge.example.workers.dev/my-project.svg)
```

`?theme=light` draws the light theme; anything else is dark. For both themes on GitHub:

```html
<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://even-keel-badge.example.workers.dev/my-project.svg?theme=light">
  <img alt="Even Keel" src="https://even-keel-badge.example.workers.dev/my-project.svg">
</picture>
```

## What it answers

| Request | Answer |
| --- | --- |
| `POST /push/<slug>` with `Authorization: Bearer <secret>` and the state as JSON | `204`, the state is stored; a wrong or missing secret (or no `BADGE_SECRET` on the Worker) — `401`; a body that is no state of version 1 — `400` |
| `GET /<slug>.svg[?theme=light]` | the badge drawn at the moment of the request: "updated N min ago", the grey dot after 5 minutes and OFFLINE after an hour are counted then; a slug without a state draws "NOT PUBLISHED YET". `Cache-Control: no-cache, max-age=0`, an `ETag`, and `304` to a matching `If-None-Match` |
| anything else | `404` |

## Updating

The drawing comes from the npm package [`even-keel-badge`](https://www.npmjs.com/package/even-keel-badge), released
with Even Keel under its version. The folder asks for its `latest` release and keeps no lock, so every build installs
the newest drawing:

- **Deployed with the button**: a new build picks it up — a push to the Worker's repository, or a retry of the last
  build in the Cloudflare dashboard.
- **Deployed by hand**: `npm update even-keel-badge`, then `npx wrangler deploy`.

The Worker's own code (`src/worker.ts`, `src/state.ts`) changes rarely; when it does, pull this folder's changes into
your repository. A Worker deployed before the package existed has its own copy of the drawing in `src/badge/`: pulling
this folder replaces it with the package.
