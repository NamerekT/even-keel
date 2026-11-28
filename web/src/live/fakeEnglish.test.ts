import { describe, expect, it } from 'vitest'
import { createFakeSource } from './fake.js'
import { withEnglishContent } from './fakeEnglish.js'

const CYRILLIC = /[Ѐ-ӿ]/

function cyrillicOf(value: unknown): string[] {
  const found: string[] = []
  JSON.stringify(value, (_key, each: unknown) => {
    if (typeof each === 'string' && CYRILLIC.test(each)) found.push(each)
    return each
  })
  return found
}

describe('content=en', () => {
  it('leaves no Russian text in the default state, for the guide frames', () => {
    expect(cyrillicOf(createFakeSource('?content=en').snapshot().state)).toEqual([])
  })

  it('names tasks, milestones and the feed in English', () => {
    const state = createFakeSource('?content=en').snapshot().state!
    const abc5 = state.tasks.find((task) => task.id === 'ABC-5')!
    expect(abc5.title).toBe('Chain tasks by their links')
    expect(JSON.stringify(abc5)).toContain('v0.1 — skeleton')
    expect(state.sessions.find((view) => view.task === 'ABC-5')!.feed.map((line) => line.text)).toContain('Reading the task description and attachments.')
  })

  it('gives a task card in English too, its question label included', async () => {
    const card = await createFakeSource('?content=en').card('ABC-13')
    expect(cyrillicOf(card)).toEqual([])
    expect(card!.labels.map((label) => label.name)).toContain('Question')
  })

  it('keeps the Russian content without the parameter', () => {
    const state = createFakeSource('').snapshot().state!
    expect(state.tasks.find((task) => task.id === 'ABC-5')!.title).toBe('Цепочка задач по связям')
  })

  it('copies the value and leaves strings outside the dictionary alone', () => {
    const value = { title: 'Страница проекта', other: 'kept', list: ['Переделка', 3, null] }
    expect(withEnglishContent(value)).toEqual({ title: 'Project page', other: 'kept', list: ['Rework', 3, null] })
    expect(value.title).toBe('Страница проекта')
  })
})
