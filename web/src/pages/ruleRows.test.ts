import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, type ChainRules } from '../../../src/chain/rules.js'
import type { TaskStatus } from '../../../src/tracker/model.js'
import {
  effectiveRules,
  feedRulesOf,
  knownStatuses,
  ownRulesOf,
  labelRows,
  milestoneModeOf,
  ruleOrigins,
  settled,
  statusRows,
  withLabel,
  withMilestoneMode,
  withPlace,
} from './ruleRows.js'

const STATUSES: TaskStatus[] = [
  { name: 'Backlog', category: 'UnStarted' },
  { name: 'Todo', category: 'ToDo' },
  { name: 'Blocked', category: 'Active' },
  { name: 'Done', category: 'Won' },
  { name: 'Canceled', category: 'Lost' },
]
const SHARED = { active: 'shared', terminal: 'shared' } as const
const rules = (over: Partial<ChainRules>): ChainRules => ({ ...DEFAULT_RULES, ...over })
const places = (rows: { name: string; place: string }[]) => Object.fromEntries(rows.map((row) => [row.name, row.place]))

describe('knownStatuses', () => {
  it('takes the tracker’s statuses, then the tasks’ and the listed ones, a name once whatever its case', () => {
    const known = knownStatuses([[{ name: 'todo', category: 'ToDo' }, ...STATUSES]], [{ name: 'Review', category: 'Active' }], rules({ active: ['Gone', 'TODO'] }))
    expect(known).toEqual([
      { name: 'todo', category: 'ToDo' },
      ...STATUSES.filter((status) => status.name !== 'Todo'),
      { name: 'Review', category: 'Active' },
      { name: 'Gone', category: null },
    ])
  })
})

describe('statusRows', () => {
  it('places each status by its category while no list is set', () => {
    const rows = statusRows(STATUSES, DEFAULT_RULES, DEFAULT_RULES, SHARED)
    expect(places(rows)).toEqual({ Backlog: 'out', Todo: 'in', Blocked: 'in', Done: 'closed', Canceled: 'closed' })
    expect(rows.every((row) => row.origin === 'category')).toBe(true)
  })

  it('names the level of the list that decides, and what the status would be without it', () => {
    const rows = statusRows(STATUSES, rules({ active: ['Todo'] }), DEFAULT_RULES, { active: 'profile', terminal: 'shared' })
    expect(rows.find((row) => row.name === 'Blocked')).toEqual({ name: 'Blocked', category: 'Active', place: 'out', origin: 'profile', inherited: 'in' })
    expect(rows.find((row) => row.name === 'Done')).toMatchObject({ place: 'closed', origin: 'category' })
  })

  it('takes a closed status left out of the closed list as the closed list’s', () => {
    const rows = statusRows(STATUSES, rules({ terminal: ['Done'] }), DEFAULT_RULES, { active: 'shared', terminal: 'project' })
    expect(rows.find((row) => row.name === 'Canceled')).toMatchObject({ place: 'out', origin: 'project', inherited: 'closed' })
    expect(rows.find((row) => row.name === 'Todo')).toMatchObject({ place: 'in', origin: 'category' })
  })
})

describe('withPlace', () => {
  const rows = statusRows(STATUSES, DEFAULT_RULES, DEFAULT_RULES, SHARED)

  it('writes the lists in full once a status leaves its category’s place', () => {
    expect(withPlace(rows, 'Blocked', 'out')).toEqual({ active: ['Todo'] })
    expect(withPlace(rows, 'Backlog', 'closed')).toEqual({ terminal: ['Backlog', 'Done', 'Canceled'] })
  })

  it('changes both lists when a status goes from one of them to the other', () => {
    // A closed status is out of the active ones whatever its category: the categories still say which are in.
    expect(withPlace(rows, 'Todo', 'closed')).toEqual({ active: null, terminal: ['Todo', 'Done', 'Canceled'] })
    const listed = statusRows(STATUSES, rules({ active: ['Backlog', 'Todo'], terminal: ['Done'] }), DEFAULT_RULES, SHARED)
    expect(withPlace(listed, 'Todo', 'closed')).toEqual({ active: ['Backlog'], terminal: ['Todo', 'Done'] })
  })

  it('leaves the list a move does not touch as it is, an inherited one too', () => {
    const inherited = statusRows(STATUSES, rules({ terminal: ['Done', 'Canceled'] }), DEFAULT_RULES, SHARED)
    expect(withPlace(inherited, 'Backlog', 'in')).toEqual({ active: ['Backlog', 'Todo', 'Blocked'] })
  })

  it('goes back to the categories once every status is where its category puts it', () => {
    const moved = statusRows(STATUSES, rules({ active: ['Todo'] }), DEFAULT_RULES, SHARED)
    expect(withPlace(moved, 'Blocked', 'in')).toEqual({ active: null })
  })

  it('spells the list out on demand, for a level that cannot keep "by the categories"', () => {
    expect(withPlace(rows, 'Blocked', 'out', true)).toEqual({ active: ['Todo'] })
    expect(withPlace(statusRows(STATUSES, rules({ active: ['Todo'] }), DEFAULT_RULES, SHARED), 'Blocked', 'in', true)).toEqual({ active: ['Todo', 'Blocked'] })
  })

  it('keeps a status of no known category in a list', () => {
    const known = [...STATUSES, { name: 'Gone', category: null }]
    expect(withPlace(statusRows(known, DEFAULT_RULES, DEFAULT_RULES, SHARED), 'Gone', 'in')).toEqual({ active: ['Todo', 'Blocked', 'Gone'] })
  })
})

describe('settled', () => {
  it('leaves a value equal to the inherited one to the level above where the level may', () => {
    expect(settled(['Todo'], ['Todo'], ['Todo', 'Blocked'], true)).toBeUndefined()
    expect(settled(['Todo'], ['Todo'], ['Todo', 'Blocked'], false)).toEqual(['Todo'])
  })

  it('spells "by the categories" as the list where the level cannot keep it', () => {
    expect(settled(null, ['Todo'], ['Todo', 'Blocked'], true)).toEqual(['Todo', 'Blocked'])
    expect(settled(null, null, ['Todo', 'Blocked'], true)).toBeUndefined()
    expect(settled(null, ['Todo'], ['Todo'], false)).toBeNull()
  })
})

describe('labelRows', () => {
  it('shows the built-in labels first, the run labels only while they pick a model, then the lists’ own', () => {
    const rows = labelRows(rules({ requiredLabels: ['agent-ok'], excludedLabels: ['wip', 'manual'] }), { requiredLabels: 'project', excludedLabels: 'shared' }, ['Claude | opus', 'Bug'], true)
    expect(rows).toEqual([
      { name: 'Manual', rule: 'manual', origin: 'builtin' },
      { name: 'Вручную', rule: 'manual', origin: 'builtin' },
      { name: 'Question', rule: 'question', origin: 'builtin' },
      { name: 'Вопрос', rule: 'question', origin: 'builtin' },
      { name: 'Claude | opus', rule: 'run', origin: 'builtin' },
      { name: 'agent-ok', rule: 'required', origin: 'project' },
      { name: 'wip', rule: 'excluded', origin: 'shared' },
    ])
    expect(labelRows(DEFAULT_RULES, { requiredLabels: 'shared', excludedLabels: 'shared' }, ['Claude | opus'], false).some((row) => row.rule === 'run')).toBe(false)
  })
})

describe('withLabel', () => {
  const now = rules({ requiredLabels: ['agent-ok'], excludedLabels: ['wip'] })

  it('moves a label from one list to the other', () => {
    expect(withLabel(now, 'WIP', 'required')).toEqual({ requiredLabels: ['agent-ok', 'WIP'], excludedLabels: [] })
  })

  it('drops a label from both lists', () => {
    expect(withLabel(now, 'agent-ok', null)).toEqual({ requiredLabels: [], excludedLabels: ['wip'] })
  })
})

describe('milestones', () => {
  it('tells the mode by the lists set', () => {
    expect(milestoneModeOf(DEFAULT_RULES)).toBe('all')
    expect(milestoneModeOf(rules({ requiredMilestones: ['v0.2'], excludedMilestones: ['v0.1'] }))).toBe('only')
    expect(milestoneModeOf(rules({ excludedMilestones: ['v0.1'] }))).toBe('except')
  })

  it('keeps only the list of the mode picked', () => {
    const both = rules({ requiredMilestones: ['v0.2'], excludedMilestones: ['v0.1'] })
    expect(withMilestoneMode(both, 'except')).toEqual({ requiredMilestones: [], excludedMilestones: ['v0.1'] })
    expect(withMilestoneMode(both, 'all')).toEqual({ requiredMilestones: [], excludedMilestones: [] })
    expect(withMilestoneMode(both, 'only')).toEqual({ requiredMilestones: ['v0.2'], excludedMilestones: ['v0.1'] })
  })
})

describe('a project’s rules', () => {
  const shared = rules({ requiredLabels: ['Auto'] })
  const profile = { active: ['Todo'], excludedLabels: ['wip'] }

  it('puts the profile’s keys under the project’s own', () => {
    const own = rules({ requiredLabels: ['Auto'], active: null, terminal: ['Done'] })
    expect(effectiveRules(own, ['terminal'], profile)).toEqual(rules({ requiredLabels: ['Auto'], active: ['Todo'], terminal: ['Done'], excludedLabels: ['wip'] }))
  })

  it('names a key the project’s while it differs from what the project inherits', () => {
    const inherited = effectiveRules(shared, [], profile)
    const origins = ruleOrigins(rules({ ...inherited, terminal: ['Done'] }), inherited, profile)
    expect(origins).toMatchObject({ active: 'profile', terminal: 'project', requiredLabels: 'shared', excludedLabels: 'profile' })
  })
})

describe('the rules of a feed', () => {
  const shared: ChainRules = { ...DEFAULT_RULES, excludedLabels: ['Never'] }
  const profile = { terminal: ['Shipped'], excludedLabels: ['wontfix'] }

  it('are its own keys over its profile over the shared ones, nothing of the project', () => {
    expect(feedRulesOf(shared, profile, { requiredLabels: ['agent'] })).toEqual({ ...DEFAULT_RULES, terminal: ['Shipped'], excludedLabels: ['wontfix'], requiredLabels: ['agent'] })
    expect(feedRulesOf(shared, {}, { active: null })).toEqual(shared)
  })

  it('save only the keys that differ from what the feed inherits, a status list back to the categories as null', () => {
    const inherited = feedRulesOf(shared, profile)
    expect(ownRulesOf({ ...inherited, requiredLabels: ['agent'], terminal: null }, inherited)).toEqual({ requiredLabels: ['agent'], terminal: null })
    expect(ownRulesOf(inherited, inherited)).toEqual({})
  })
})
