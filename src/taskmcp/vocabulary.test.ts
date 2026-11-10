import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, type ChainRules } from '../chain/rules.js'
import type { TrackerVocabulary } from '../tracker/source.js'
import { promptLines, rolesLine, type TrackerTerms } from './vocabulary.js'

const KNOWN: TrackerVocabulary = {
  statuses: [
    { name: 'Backlog', category: 'UnStarted' },
    { name: 'Todo', category: 'ToDo' },
    { name: 'Ready', category: 'UnStarted' },
    { name: 'In Progress', category: 'Active' },
    { name: 'Done', category: 'Won' },
  ],
  labels: ['Bug', 'Вручную', 'Вопрос', 'agent'],
  milestones: ['v0.3', 'v0.4'],
}
const terms = (rules: Partial<ChainRules> = {}, more: Partial<TrackerTerms> = {}): TrackerTerms => ({
  known: KNOWN,
  rules: { ...DEFAULT_RULES, excludedLabels: ['Вручную'], ...rules },
  priority: true,
  estimate: true,
  components: null,
  attachments: true,
  blocking: true,
  ...more,
})

describe('rolesLine', () => {
  it('names the status that puts a task into the chain, the skip and question labels, milestones and fields', () => {
    expect(rolesLine(terms())).toBe('chain: into it — Todo; skip — Вручную; question — Вопрос; milestones v0.3, v0.4; priority: yes; estimate: yes')
  })

  it('takes the status from chain.active, not the tracker\'s Todo', () => {
    expect(rolesLine(terms({ active: ['ready'] }))).toMatch(/^chain: into it — Ready; /)
  })

  it('names a required label as the tracker spells it, and none where a role has no label', () => {
    const line = rolesLine({ ...terms({ requiredLabels: ['AGENT'], excludedLabels: ['Manual'] }), known: { ...KNOWN, labels: ['agent'], milestones: [] } })
    expect(line).toBe('chain: into it — Todo with the label agent; skip — none; question — none; no milestones; priority: yes; estimate: yes')
  })

  it('names no skip label under the default rules: none is excluded (BTN-971)', () => {
    expect(rolesLine({ ...terms(), rules: DEFAULT_RULES, known: { ...KNOWN, labels: ['Manual', 'Вручную', 'Вопрос'] } })).toMatch(/; skip — none; question — Вопрос; /)
  })

  it('a status the active list names but the tracker lacks leaves nothing to put the task into', () => {
    expect(rolesLine(terms({ active: ['Queued'] }))).toMatch(/^chain: into it — none; /)
  })

  it('leaves the milestones out of a short line and says which fields the tracker lacks', () => {
    expect(rolesLine(terms({}, { priority: false, estimate: false }), false)).toBe('chain: into it — Todo; skip — Вручную; question — Вопрос; priority: no; estimate: no')
  })

  it('names the components of a tracker that keeps them and says when a tracker takes no files', () => {
    expect(rolesLine(terms({}, { components: ['UI', 'Server'] }), false)).toMatch(/; estimate: yes; components: UI, Server$/)
    expect(rolesLine(terms({}, { components: [] }), false)).toMatch(/; components: none$/)
    expect(rolesLine(terms({}, { attachments: false }), false)).toMatch(/; estimate: yes; attachments: no$/)
  })

  it('says when a tracker keeps no blocking links (BTN-927)', () => {
    expect(rolesLine(terms({}, { blocking: false, components: ['UI'] }), false)).toMatch(/; estimate: yes; blocking links: no; components: UI$/)
  })

  it('a tracker without a vocabulary says so', () => {
    expect(rolesLine({ ...terms(), known: null })).toMatch(/gives no vocabulary/)
  })
})

describe('promptLines', () => {
  it('a project with one tracker gets its roles line alone', () => {
    expect(promptLines([{ prefix: 'BTN', title: 'Huly', terms: terms() }], 'BTN')).toEqual([rolesLine(terms())])
  })

  it('with feeds: the trackers, a full line of the task\'s own and a short one of each other, by its own rules', () => {
    const feed = terms({ active: ['Ready'] }, { priority: false, estimate: false })
    const lines = promptLines(
      [
        { prefix: 'BTN', title: 'Huly', terms: terms() },
        { prefix: 'BTNGH', title: 'GitHub', terms: feed },
      ],
      'BTNGH',
    )
    expect(lines).toEqual([
      'trackers: BTN — Huly, BTNGH — GitHub (this task)',
      'BTN chain: into it — Todo; skip — Вручную; question — Вопрос; priority: yes; estimate: yes',
      'BTNGH chain: into it — Ready; skip — Вручную; question — Вопрос; milestones v0.3, v0.4; priority: no; estimate: no',
    ])
  })

  it('a tracker that was not read gets no roles line', () => {
    expect(promptLines([{ prefix: 'BTN', title: 'Huly', terms: null }], 'BTN')).toEqual([])
    expect(promptLines([{ prefix: 'BTN', title: 'Huly', terms: null }, { prefix: 'GH', title: 'GitHub', terms: terms() }], 'BTN')).toHaveLength(2)
  })
})
