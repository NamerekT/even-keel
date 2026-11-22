import { describe, expect, it } from 'vitest'
import { skillOrder, shownSkills } from './skillList.js'

const skill = (name: string) => ({ name, from: 'claude', wrapped: false })
const list = ['api-review', 'coding', 'deploy', 'web-review'].map(skill)

describe('skillOrder', () => {
  it('puts the ticked skills first and keeps the rest in the given order', () => {
    expect(skillOrder(list, new Set(['web-review', 'coding']))).toEqual(['coding', 'web-review', 'api-review', 'deploy'])
  })
})

describe('shownSkills', () => {
  const first = ['coding', 'web-review', 'api-review', 'deploy']

  it('keeps the first order, whatever is ticked now', () => {
    expect(shownSkills(first, list, null, '').map((each) => each.name)).toEqual(first)
  })

  it('finds a part of the name, in any case', () => {
    expect(shownSkills(first, list, null, ' REV ').map((each) => each.name)).toEqual(['web-review', 'api-review'])
  })

  it('shows only the skills of the filter', () => {
    expect(shownSkills(first, list, new Set(['deploy', 'coding']), '').map((each) => each.name)).toEqual(['coding', 'deploy'])
  })

  it('adds a skill that appeared after the open at the end and drops one that is gone', () => {
    const now = [...list.filter((each) => each.name !== 'deploy'), skill('a-new-one')]
    expect(shownSkills(first, now, null, '').map((each) => each.name)).toEqual(['coding', 'web-review', 'api-review', 'a-new-one'])
  })
})
