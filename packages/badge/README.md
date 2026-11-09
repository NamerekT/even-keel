# even-keel-badge

Draws the README badge of an [Even Keel](https://github.com/NamerekT/even-keel) project — what its chain of agent
sessions is doing right now — as one self-contained SVG: no script and no outside resource, the fonts embedded.

It is the drawing of the badge's Cloudflare Worker
([`deploy/badge`](https://github.com/NamerekT/even-keel/tree/main/deploy/badge)); you need it directly only to serve the
badge some other way. The package is released with Even Keel and has its version.

```ts
import { renderBadge } from 'even-keel-badge'

const svg = renderBadge(state, { theme: 'dark', now: new Date() })
```

`state` is the state Even Keel pushes (contract version `BADGE_VERSION`), or `null` for "not published yet". The
contract is described in [`docs/badge.md`](https://github.com/NamerekT/even-keel/blob/main/docs/badge.md).

MIT. The embedded fonts, Inter and JetBrains Mono, are under the SIL Open Font License 1.1: `dist/fonts/`.
