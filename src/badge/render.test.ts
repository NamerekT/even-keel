import { describe, expect, it } from 'vitest'
import type { BadgeState } from './model.js'
import { badgeMode, renderBadge } from './render.js'
import { escapeXml, fit, measure } from './text.js'

const now = new Date('2026-11-09T12:00:00Z')
const live: BadgeState = {
  v: 1,
  at: '2026-11-09T11:59:30Z',
  project: { key: 'ABC', name: 'Example' },
  active: [
    {
      key: 'ABC-15',
      titleEn: 'Draw the badge and push the chain state to a Worker',
      agent: 'claude',
      model: 'opus',
      startedAt: '2026-11-09T11:18:00Z',
      state: 'working',
      action: { tool: 'Edit', text: 'Edit src/badge/render.ts' },
      context: 48,
    },
  ],
  chain: {
    state: 'running',
    next: 'ABC-16',
    tasks: [
      { key: 'ABC-14', state: 'done' },
      { key: 'ABC-15', state: 'working' },
      { key: 'ABC-16', state: 'queued' },
    ],
  },
  milestone: { name: 'v1', done: 4, left: 2 },
  stats: { sessions: 12, medianCost: 1.2, medianMinutes: 18 },
}
const two: BadgeState = {
  ...live,
  active: [live.active[0]!, { key: 'ABC-17', agent: 'codex', model: 'gpt-5', startedAt: '2026-11-09T11:52:00Z', state: 'working', action: { tool: 'Bash', text: 'Bash Run the tests' }, context: 12 }],
}
const waiting: BadgeState = { ...live, active: [{ ...live.active[0]!, state: 'waiting' }] }
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()

const STATES: Record<string, BadgeState | null> = {
  live,
  two,
  waiting,
  stale: { ...live, at: at(20) },
  offline: { ...live, at: at(180) },
  paused: { ...live, active: [], chain: { ...live.chain, state: 'paused' } },
  stopped: { ...live, active: [], chain: { ...live.chain, state: 'stopped' } },
  idle: { ...live, active: [], chain: { ...live.chain, state: 'idle' } },
  unpublished: null,
}

describe('renderBadge', () => {
  for (const [name, state] of Object.entries(STATES)) {
    for (const theme of ['dark', 'light'] as const) {
      it(`draws the ${name} state in the ${theme} theme`, async () => {
        await expect(renderBadge(state, { theme, now, fonts: false })).toMatchFileSnapshot(`./__snapshots__/${name}-${theme}.svg`)
      })
    }
  }

  it('tells each state apart by the age of its push and the chain', () => {
    expect(Object.fromEntries(Object.entries(STATES).map(([name, state]) => [name, badgeMode(state, now)]))).toEqual({
      live: 'live',
      two: 'live',
      waiting: 'live',
      stale: 'stale',
      offline: 'offline',
      paused: 'still',
      stopped: 'still',
      idle: 'still',
      unpublished: 'unpublished',
    })
  })

  it('animates only a live or stale badge: offline, still and unpublished ones are frozen', () => {
    const animated = (state: BadgeState | null) => /class="(ring|breathe|blink|glow)"/.test(renderBadge(state, { theme: 'dark', now, fonts: false }))
    expect(animated(live)).toBe(true)
    expect(animated(STATES.stale!)).toBe(true)
    for (const name of ['offline', 'paused', 'stopped', 'idle', 'unpublished']) expect(animated(STATES[name]!)).toBe(false)
  })

  it('names the state and the tasks for screen readers and says "was working on" offline', () => {
    const svg = renderBadge(STATES.offline!, { theme: 'dark', now, fonts: false })
    expect(svg).toMatch(/<title>ABC · Example\. OFFLINE · last seen 3 h ago/)
    expect(svg).toContain('was working on')
    expect(renderBadge(waiting, { theme: 'dark', now, fonts: false })).toContain("waiting for the maintainer&apos;s answer")
  })

  it('embeds its three fonts and loads nothing from outside, no script', () => {
    const svg = renderBadge(live, { theme: 'dark', now })
    expect(svg.match(/@font-face/g)).toHaveLength(3)
    expect(svg).not.toMatch(/<script|href="http|url\(http/)
  })

  it('escapes every text it draws', () => {
    const hostile: BadgeState = {
      ...live,
      project: { key: 'A&B', name: '<x> "y"' },
      active: [{ ...live.active[0]!, titleEn: 'a < b & "c"', action: { tool: 'Bash', text: "Bash it's <b>\u0007" } }],
    }
    const svg = renderBadge(hostile, { theme: 'light', now, fonts: false })
    expect(svg).toContain('A&amp;B · &lt;x&gt; &quot;y&quot;')
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;')
    expect(svg).toContain('Bash it&apos;s &lt;b&gt;')
    expect(svg).not.toContain('\u0007')
    expect(svg).not.toContain('<b>')
  })

  it('cuts a long title to fit with an ellipsis, the screen readers still get it whole', () => {
    const title = 'word '.repeat(60).trim()
    const svg = renderBadge({ ...live, active: [{ ...live.active[0]!, titleEn: title }] }, { theme: 'dark', now, fonts: false })
    const drawn = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!)
    expect(drawn.some((text) => /^word( word)*…$/.test(text))).toBe(true)
    expect(drawn).not.toContain(title)
    expect(svg).toMatch(new RegExp(`<title>[^<]*${title}`))
  })

  const texts = (state: BadgeState) => [...renderBadge(state, { theme: 'dark', now, fonts: false }).matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((match) => match[1]!.replace(/<[^>]+>/g, ''))

  it('says in its header what the chain does, as the mockups do', () => {
    expect(texts(live)).toContain('Example is being built right now')
    expect(texts(two)).toContain('Example is being built right now · 2 tasks at once')
    expect(texts(waiting)).toContain('the agent asked the maintainer and waits for the answer')
  })

  it('puts a single task\'s agent, model and start under its title, and a task of several on the right', () => {
    expect(texts(live)).toContain('Claude Code · opus · started 42 min ago')
    expect(texts(two)).toContain('Claude Code · opus · 42 min')
    expect(texts(two)).toContain('Codex · gpt-5 · 8 min')
  })

  it('shows the context of a waiting task next to the waiting line', () => {
    expect(texts(waiting)).toContain('context 48%')
  })

  it('names a chip of the project by its number and one of another project by its key', () => {
    const chips = texts({ ...live, chain: { ...live.chain, tasks: [...live.chain.tasks!, { key: 'XYZ-3', state: 'queued' }] } })
    expect(chips).toEqual(expect.arrayContaining(['14', '15', '16', 'XYZ-3']))
    expect(chips).not.toContain('ABC-14')
  })

  it('writes the footer as one line with thousands separated', () => {
    expect(texts({ ...live, stats: { sessions: 1667, medianCost: 2.15, medianMinutes: 12 } })).toContain('1,667 sessions · median task $2.15* · 12 min* at API list prices')
  })
})

describe('the width table', () => {
  it('measures by the embedded fonts: a monospace character is one width, a sans one varies', () => {
    expect(measure('iiii', 'mono', 10)).toBeCloseTo(measure('WWWW', 'mono', 10))
    expect(measure('iiii', 'sans', 10)).toBeLessThan(measure('WWWW', 'sans', 10))
    expect(measure('abc', 'sans', 20)).toBeCloseTo(measure('abc', 'sans', 10) * 2)
    expect(measure('abc', 'sans-bold', 10)).toBeGreaterThan(measure('abc', 'sans', 10))
  })

  it('keeps a text that fits and cuts one that does not to within the width', () => {
    expect(fit('short', 'sans', 13, 200)).toBe('short')
    const cut = fit('a fairly long line of text that will not fit', 'sans', 13, 120)
    expect(cut.endsWith('…')).toBe(true)
    expect(measure(cut, 'sans', 13)).toBeLessThanOrEqual(120)
    expect(fit('anything', 'sans', 13, 2)).toBe('')
  })

  it('counts a character the fonts lack as wide, so the cut still fits', () => {
    expect(measure('Ж', 'sans', 10)).toBeCloseTo(7.2)
    expect(measure(fit('ЖЖЖЖЖЖЖЖЖЖ', 'sans', 10, 40), 'sans', 10)).toBeLessThanOrEqual(40)
  })
})

describe('escapeXml', () => {
  it('escapes the five characters and drops the control ones XML forbids, keeping tabs and newlines', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;')
    expect(escapeXml('a\u0000b\u001fc\td\ne')).toBe('abc\td\ne')
  })
})
