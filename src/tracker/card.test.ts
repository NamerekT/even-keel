import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { cardOf, type TrackerCard, type TrackerMoves } from './card.js'

const ALL: TrackerMoves = { ready: true, unready: true, relabel: true }
const NONE: TrackerMoves = { ready: false, unready: false, relabel: false }

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
    const card = cardOf(raw({ labels: ['Claude | opus', 'Вопрос', 'manual', 'UI'] }), DEFAULT_RULES, ALL)
    expect(card.labels).toEqual([
      { name: 'Claude | opus', role: 'model' },
      { name: 'Вопрос', role: 'question' },
      { name: 'manual', role: 'excluded' },
      { name: 'UI', role: null },
    ])
  })

  it('offers the move to ToDo only for a task in a backlog status of a tracker that can do it', () => {
    expect(cardOf(raw(), DEFAULT_RULES, ALL).ready).toBe(true)
    expect(cardOf(raw(), DEFAULT_RULES, NONE).ready).toBe(false)
    expect(cardOf(raw({ status: { name: 'Todo', category: 'ToDo' } }), DEFAULT_RULES, ALL).ready).toBe(false)
  })

  it('offers "Into the chain" for an open task without the required label where the tracker can label it', () => {
    const rules = { ...DEFAULT_RULES, requiredLabels: ['Agent'], excludedLabels: ['Manual'] }
    const todo = { status: { name: 'Open', category: 'ToDo' as const } }
    expect(cardOf(raw(todo), rules, { ...NONE, relabel: true }).ready).toBe(true)
    expect(cardOf(raw(todo), rules, NONE).ready).toBe(false)
    expect(cardOf(raw({ ...todo, labels: ['agent'] }), rules, ALL).ready).toBe(false)
    expect(cardOf(raw({ ...todo, labels: ['Manual'] }), rules, ALL).ready).toBe(false)
    expect(cardOf(raw({ status: { name: 'Closed', category: 'Won' } }), rules, ALL).ready).toBe(false)
  })

  it('offers "To the backlog" for a ready or started task, or one with the required label where the tracker can take it off', () => {
    const rules = { ...DEFAULT_RULES, requiredLabels: ['Agent'] }
    const todo = { status: { name: 'Todo', category: 'ToDo' as const } }
    expect(cardOf(raw(todo), DEFAULT_RULES, { ...NONE, unready: true }).unready).toBe(true)
    expect(cardOf(raw({ status: { name: 'Doing', category: 'Active' } }), DEFAULT_RULES, ALL).unready).toBe(true)
    expect(cardOf(raw(), DEFAULT_RULES, ALL).unready).toBe(false)
    expect(cardOf(raw(todo), DEFAULT_RULES, { ...NONE, relabel: true }).unready).toBe(false)
    expect(cardOf(raw({ ...todo, labels: ['Agent'] }), rules, { ...NONE, relabel: true }).unready).toBe(true)
    expect(cardOf(raw({ status: { name: 'Closed', category: 'Won' }, labels: ['Agent'] }), rules, ALL).unready).toBe(false)
  })

  it('names the required labels when the task has none of them', () => {
    const rules = { ...DEFAULT_RULES, requiredLabels: ['Agent', 'Bot'] }
    expect(cardOf(raw({ labels: ['UI'] }), rules, ALL).requires).toEqual(['Agent', 'Bot'])
    const card = cardOf(raw({ labels: ['agent'] }), rules, ALL)
    expect(card.requires).toEqual([])
    expect(card.labels).toEqual([{ name: 'agent', role: 'required' }])
    expect(cardOf(raw(), DEFAULT_RULES, ALL).requires).toEqual([])
  })

  it('offers the milestones in the chain order, or none when the tracker cannot move a task', () => {
    const choices = [
      { id: 'm3', label: 'v0.10', targetDate: null },
      { id: 'm1', label: 'v0.2', targetDate: 2 },
      { id: 'm2', label: 'Later', targetDate: 1 },
    ]
    const card = cardOf(raw(), DEFAULT_RULES, ALL, { current: 'm1', choices })
    expect(card.milestones).toEqual({ current: 'm1', choices: [choices[1], choices[0], choices[2]] })
    expect(cardOf(raw(), DEFAULT_RULES, ALL).milestones).toBeNull()
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
      ALL,
    )
    expect(card.attachments.map((each) => each.url)).toEqual(['/api/tasks/ABC-1/files/shot%201.png', 'https://example.com/clip.mp4'])
  })
})
