import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { cardOf, type TrackerCard } from './card.js'

const raw = (fields: Partial<TrackerCard> = {}): TrackerCard => ({
  id: 'ABC-1',
  title: 'Title',
  description: '',
  status: { name: 'Backlog', category: 'UnStarted' },
  priority: 'none',
  labels: [],
  milestone: null,
  parent: null,
  blockedBy: [],
  blocks: [],
  related: [],
  comments: [],
  attachments: [],
  ...fields,
})

describe('cardOf', () => {
  it('tells what each label means to Even Keel', () => {
    const card = cardOf(raw({ labels: ['Opus', 'Вопрос', 'manual', 'UI'] }), DEFAULT_RULES, true)
    expect(card.labels).toEqual([
      { name: 'Opus', role: 'model' },
      { name: 'Вопрос', role: 'question' },
      { name: 'manual', role: 'excluded' },
      { name: 'UI', role: null },
    ])
  })

  it('offers the move to ToDo only for a task in a backlog status of a tracker that can do it', () => {
    expect(cardOf(raw(), DEFAULT_RULES, true).ready).toBe(true)
    expect(cardOf(raw(), DEFAULT_RULES, false).ready).toBe(false)
    expect(cardOf(raw({ status: { name: 'Todo', category: 'ToDo' } }), DEFAULT_RULES, true).ready).toBe(false)
  })

  it('names the required labels when the task has none of them', () => {
    const rules = { ...DEFAULT_RULES, requiredLabels: ['Agent', 'Bot'] }
    expect(cardOf(raw({ labels: ['UI'] }), rules, true).requires).toEqual(['Agent', 'Bot'])
    const card = cardOf(raw({ labels: ['agent'] }), rules, true)
    expect(card.requires).toEqual([])
    expect(card.labels).toEqual([{ name: 'agent', role: 'required' }])
    expect(cardOf(raw(), DEFAULT_RULES, true).requires).toEqual([])
  })

  it('sends a file without its own link through the service', () => {
    const card = cardOf(
      raw({
        id: 'ABC-1',
        attachments: [
          { file: 'shot 1.png', name: 'shot 1.png', type: 'image/png', size: 10, url: null },
          { file: 'clip', name: 'clip.mp4', type: 'video/mp4', size: 20, url: 'https://example.com/clip.mp4' },
        ],
      }),
      DEFAULT_RULES,
      true,
    )
    expect(card.attachments.map((each) => each.url)).toEqual(['/api/tasks/ABC-1/files/shot%201.png', 'https://example.com/clip.mp4'])
  })
})
