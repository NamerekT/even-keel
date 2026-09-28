import { describe, expect, it } from 'vitest'
import { milestoneView } from './milestones.js'

const block = (id: string, milestone: string | null, open = true) => ({ id, milestone, open })
const ids = (view: ReturnType<typeof milestoneView<ReturnType<typeof block>>>) =>
  view.sections.map((section) => [section.milestone, section.blocks.map((item) => item.id)])

describe('milestoneView', () => {
  const chain = [
    block('A-1', 'v0.1', false),
    block('A-2', 'v0.1'),
    block('A-3', 'v0.1'),
    block('A-4', 'v0.2'),
    block('A-5', null),
    block('A-6', 'v0.3'),
  ]

  it('shows sections up to the first milestone with open tasks and offers the next one', () => {
    const view = milestoneView(chain, 0)
    expect(ids(view)).toEqual([['v0.1', ['A-1', 'A-2', 'A-3']]])
    expect(view.next).toEqual({ milestone: 'v0.2', blocks: [chain[3]] })
    expect(view.titled).toBe(true)
  })

  it('reveals one more section per step, a run without a milestone counting as one', () => {
    expect(milestoneView(chain, 1).next?.milestone).toBeNull()
    expect(ids(milestoneView(chain, 2)).map(([label]) => label)).toEqual(['v0.1', 'v0.2', null])
    const all = milestoneView(chain, 3)
    expect(all.sections).toHaveLength(4)
    expect(all.next).toBeNull()
  })

  it('reveals sections up to the focused task and says how many it revealed', () => {
    const view = milestoneView(chain, 0, 'A-5')
    expect(view.sections.map((section) => section.milestone)).toEqual(['v0.1', 'v0.2', null])
    expect(view.revealed).toBe(2)
    expect(milestoneView(chain, 3, 'A-2').revealed).toBe(3)
    expect(milestoneView(chain, 0, 'X-1').revealed).toBe(0)
  })

  it('splits closed tasks of a milestone from its open ones when another milestone comes between', () => {
    const view = milestoneView([block('A-1', 'v0.2', false), block('A-2', 'v0.1', false), block('A-3', 'v0.2')], 0)
    expect(ids(view)).toEqual([
      ['v0.2', ['A-1']],
      ['v0.1', ['A-2']],
      ['v0.2', ['A-3']],
    ])
  })

  it('shows open tasks without a milestone that go first, along with the first milestone after them', () => {
    const view = milestoneView([block('A-1', null), block('A-2', 'v0.1'), block('A-3', 'v0.2')], 0)
    expect(ids(view)).toEqual([
      [null, ['A-1']],
      ['v0.1', ['A-2']],
    ])
    expect(view.next?.milestone).toBe('v0.2')
  })

  it('shows everything in one untitled section when no task has a milestone', () => {
    const view = milestoneView([block('A-1', null, false), block('A-2', null)], 0)
    expect(ids(view)).toEqual([[null, ['A-1', 'A-2']]])
    expect(view).toMatchObject({ next: null, titled: false })
  })

  it('shows all sections when every milestone is closed', () => {
    const view = milestoneView([block('A-1', 'v0.1', false), block('A-2', null)], 0)
    expect(view.sections).toHaveLength(2)
    expect(view.next).toBeNull()
  })
})
