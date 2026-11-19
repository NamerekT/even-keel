import { describe, expect, it } from 'vitest'
import { CHANGE_GLUE_MS, groupChanges, type TaskChange } from './history.js'

const MIN = 60_000
const change = (at: number, field: TaskChange['field'], from: string | null, to: string | null, by: TaskChange['by'] = 'person', model: string | null = null): TaskChange =>
  ({ at, by, model, field, from, to })

describe('groupChanges', () => {
  it('glues one author\'s changes within five minutes of the first, and parts another author or a later one', () => {
    const groups = groupChanges([
      change(0, 'status', 'Backlog', 'Todo'),
      change(2 * MIN, 'milestone', null, 'v0.1'),
      change(CHANGE_GLUE_MS, 'priority', 'none', 'high'),
      change(CHANGE_GLUE_MS + 1, 'title', 'A', 'B'),
      change(CHANGE_GLUE_MS + 2, 'status', 'Todo', 'In Progress', 'agent', 'Claude | opus'),
      change(CHANGE_GLUE_MS + 3, 'status', 'In Progress', 'Done', 'agent', 'Codex | gpt'),
    ])
    expect(groups.map((group) => [group.by, group.model, group.changes.map((each) => each.field)])).toEqual([
      ['person', null, ['status', 'milestone', 'priority']],
      ['person', null, ['title']],
      ['agent', 'Claude | opus', ['status']],
      ['agent', 'Codex | gpt', ['status']],
    ])
  })

  it('shows a field changed twice as one row from the first value to the last, and none when it came back', () => {
    const [group] = groupChanges([
      change(0, 'status', 'Todo', 'In Progress', 'service'),
      change(MIN, 'estimate', null, '10', 'service'),
      change(2 * MIN, 'status', 'In Progress', 'Done', 'service'),
      change(3 * MIN, 'estimate', '10', null, 'service'),
    ])
    expect(group!.changes.map((each) => [each.field, each.from, each.to])).toEqual([['status', 'Todo', 'Done']])
  })

  it('drops a label or a link added and taken off again, ignoring case, and keeps every description', () => {
    const [group] = groupChanges([
      change(0, 'label', null, 'Bug'),
      change(1, 'label', null, 'Server'),
      change(2, 'label', 'bug', null),
      change(3, 'blocks', null, 'ABC-2'),
      change(4, 'description', null, null),
      change(5, 'description', null, null),
    ])
    expect(group!.changes.map((each) => [each.field, each.to])).toEqual([['label', 'Server'], ['blocks', 'ABC-2'], ['description', null], ['description', null]])
  })

  it('never glues changes across a comment written between them', () => {
    const groups = groupChanges([change(0, 'title', 'A', 'B'), change(2 * MIN, 'priority', 'none', 'low')], [MIN])
    expect(groups.map((group) => group.changes.map((each) => each.field))).toEqual([['title'], ['priority']])
  })

  it('leaves out a group whose changes all came back', () => {
    expect(groupChanges([change(0, 'title', 'A', 'B'), change(1, 'title', 'B', 'A')])).toEqual([])
  })
})
