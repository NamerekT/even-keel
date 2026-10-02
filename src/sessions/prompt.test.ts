import { describe, expect, it } from 'vitest'
import { fill, placeholderIn } from './prompt.js'

describe('fill', () => {
  it('puts the values in place', () => {
    expect(fill`- Ветка: ${'abc-1/task'} — не меняй её.`).toBe('- Ветка: abc-1/task — не меняй её.')
  })

  it('fails on a missing or blank value and names where it stood', () => {
    const missing = undefined as unknown as string
    expect(() => fill`- Рабочая папка: ${missing} — работай в ней.`).toThrow(/Рабочая папка: /)
    expect(() => fill`- Ветка: ${null as unknown as string}`).toThrow(/prompt/)
    expect(() => fill`- Транскрипт: ${'  '}`).toThrow(/Транскрипт: /)
    expect(() => fill`${''}`).toThrow(/prompt/)
  })

  it('fails on a value that is not text', () => {
    const value = { path: 'D:/work' } as unknown as string
    expect(() => fill`- Рабочая папка: ${value}`).toThrow(/Рабочая папка: /)
  })
})

describe('placeholderIn', () => {
  it('finds a substitution written in any of the usual forms', () => {
    expect(placeholderIn('Работай над {task}.')).toBe('{task}')
    expect(placeholderIn('Ветка {{ branch }} твоя.')).toBe('{{ branch }}')
    expect(placeholderIn('Папка ${workdir}.')).toBe('${workdir}')
  })

  it('leaves plain text and braces that are not a name alone', () => {
    expect(placeholderIn('Ты — Sonnet. Задачу не режь.')).toBeNull()
    expect(placeholderIn('Пример: { "a": 1 } и <путь>.')).toBeNull()
  })
})
