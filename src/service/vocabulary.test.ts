import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { promptLines } from '../taskmcp/vocabulary.js'
import type { Tracker } from '../tracker/source.js'
import { promptTrackers } from './vocabulary.js'

const VOCABULARY = { statuses: [{ name: 'Backlog', category: 'UnStarted' as const }, { name: 'Ready', category: 'ToDo' as const }], labels: ['Manual', 'Question'], milestones: ['v1'] }

/** Project `p1` on Huly with a GitHub feed `f1` and a feed `f2` of a tracker the tasks tools do not know; `down` — links that fail. */
function context(down: string[] = []) {
  const tracker = { vocabulary: async () => VOCABULARY, editor: {} } as unknown as Tracker
  return {
    configStore: { current: { feeds: { p1: [{ id: 'f1' }, { id: 'f2' }] } } },
    readers: () => ({ projects: {}, keys: { p1: 'BTN', f1: 'BTNGH', f2: 'OLD' }, trackers: { p1: 'huly', f1: 'github', f2: 'removed' }, trackerProjects: {}, owners: {} }),
    linkOf: (id: string) => ({ page: async <T>(call: (each: Tracker) => Promise<T>) => (down.includes(id) ? Promise.reject(new Error('down')) : call(tracker)) }),
    readerRules: (id: string) => (id === 'f1' ? { ...DEFAULT_RULES, active: ['Backlog'] } : DEFAULT_RULES),
  } as never
}

describe('promptTrackers', () => {
  it("reads each served tracker's terms by its own rules, the project's first", async () => {
    const trackers = await promptTrackers(context(), 'p1')
    expect(trackers.map((each) => [each.prefix, each.title])).toEqual([['BTN', 'Huly'], ['BTNGH', 'GitHub']])
    expect(promptLines(trackers, 'BTN')).toEqual([
      'trackers: BTN — Huly (this task), BTNGH — GitHub',
      'BTN chain: into it — Ready; skip — Manual; question — Question; milestones v1; priority: yes; estimate: no; attachments: no',
      'BTNGH chain: into it — Backlog; skip — Manual; question — Question; priority: yes; estimate: no; attachments: no',
    ])
  })

  it('a tracker that does not answer gets no line instead of holding the prompt', async () => {
    const trackers = await promptTrackers(context(['p1']), 'p1')
    expect(trackers[0]!.terms).toBeNull()
    expect(promptLines(trackers, 'BTN')).toEqual(['trackers: BTN — Huly (this task), BTNGH — GitHub', 'BTNGH chain: into it — Backlog; skip — Manual; question — Question; priority: yes; estimate: no; attachments: no'])
  })
})
