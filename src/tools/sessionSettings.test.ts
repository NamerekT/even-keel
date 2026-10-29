import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { formsOf, withProjectForm, withSharedForm } from '../config-form.js'
import { contextArgs, parseContextWindow } from '../claude/context.js'
import { withinWindow } from '../stats/checkpoint.js'
import { createSessionSettings } from './sessionSettings.js'

const project = { id: 'p', key: 'ABC', repo: 'C:/example', tracker: 'huly' }
const raw = { projects: [project] }

describe('chain auto-compaction window', () => {
  it('takes the project override, including null, before the shared value at each launch', () => {
    let config = parseConfig({ ...raw, autoCompactWindow: 300_000 })
    const settingsFor = createSessionSettings({
      config: () => config,
      packages: { otherPlugins: () => ({}), keyNames: () => [] },
      globalDir: 'C:/example-home', trim: () => false, projectOf: () => 'p',
    })
    const settings = () => JSON.parse(settingsFor('ABC-1')!)
    expect(settings()).toHaveProperty('autoCompactWindow', 300_000)
    config = parseConfig({ autoCompactWindow: 300_000, projects: [{ ...project, autoCompactWindow: 400_000 }] })
    expect(settings()).toHaveProperty('autoCompactWindow', 400_000)
    config = parseConfig({ autoCompactWindow: 300_000, projects: [{ ...project, autoCompactWindow: null }] })
    expect(settings()).not.toHaveProperty('autoCompactWindow')
    config = parseConfig(raw)
    expect(settings()).not.toHaveProperty('autoCompactWindow')
  })

  it('round trips shared, project, account and inherited values through the forms', () => {
    const forms = formsOf(parseConfig(raw))
    const shared = withSharedForm(raw, { ...forms.shared, autoCompactWindow: 300_000 }, forms.shared)
    expect(parseConfig(shared).autoCompactWindow).toBe(300_000)
    const base = formsOf(parseConfig(shared)).projects.p!
    const own = withProjectForm(shared, 'p', { ...base, own: { autoCompactWindow: 400_000 } }, base)
    expect(parseConfig(own).settings.p?.autoCompactWindow).toBe(400_000)
    const ownForm = formsOf(parseConfig(own)).projects.p!
    const account = withProjectForm(own, 'p', { ...ownForm, own: { autoCompactWindow: null } }, ownForm)
    expect(parseConfig(account).settings.p?.autoCompactWindow).toBeNull()
    const accountForm = formsOf(parseConfig(account)).projects.p!
    const inherited = withProjectForm(account, 'p', { ...accountForm, own: {} }, accountForm)
    expect(parseConfig(inherited).settings.p?.autoCompactWindow).toBe(300_000)
  })

  it.each([0, -1, 1.5, '300000', true, Infinity])('refuses an invalid window %s at either level', (autoCompactWindow) => {
    expect(() => parseConfig({ ...raw, autoCompactWindow })).toThrow(/autoCompactWindow/)
    expect(() => parseConfig({ projects: [{ ...project, autoCompactWindow }] })).toThrow(/autoCompactWindow/)
  })

  it('probes with the chain settings and moves all thresholds with the measured window', () => {
    const settingsFor = createSessionSettings({
      config: () => parseConfig({ ...raw, autoCompactWindow: 300_000 }),
      packages: { otherPlugins: () => ({}), keyNames: () => [] },
      globalDir: 'C:/example-home', trim: () => false, projectOf: () => 'p',
    })
    const args = contextArgs('opus', settingsFor('ABC-1'))
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toHaveProperty('autoCompactWindow', 300_000)
    const measured = (window: string) => parseContextWindow(JSON.stringify({ result: `**Tokens:** 1k / ${window} (1%)` }))
    const threshold = { first: 250_000, source: 'calibrated' as const }
    expect(withinWindow(threshold, measured('250k'), undefined, 'claude')).toMatchObject({ first: 180_000, late: 188_000, hard: 203_000 })
    expect(withinWindow(threshold, measured('300k'), undefined, 'claude')).toMatchObject({ first: 216_000, late: 238_000, hard: 253_000 })
  })
})
