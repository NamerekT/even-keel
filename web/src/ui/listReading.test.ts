import { describe, expect, it } from 'vitest'
import { listLoaderOf, listLookOf } from './listReading.js'

describe('listLoaderOf', () => {
  it('shows the entrance at once when the values start to be read, before the phase has stepped', () => {
    expect(listLoaderOf('done', true)).toBe('in')
  })

  it('shows nothing once the loader has left and nothing is read', () => {
    expect(listLoaderOf('done', false)).toBeNull()
  })

  it('keeps the phase the loader is in, the exit too', () => {
    expect(listLoaderOf('wait', true)).toBe('wait')
    expect(listLoaderOf('out', false)).toBe('out')
  })
})

describe('listLookOf', () => {
  it('shows nothing until the field is pressed, however long the values are read', () => {
    expect(listLookOf(false, 'wait', 3)).toBe('closed')
    expect(listLookOf(false, null, 3)).toBe('closed')
  })

  it('shows the loader while the values are read, even with some already there', () => {
    expect(listLookOf(true, 'in', 0)).toBe('loader')
    expect(listLookOf(true, 'wait', 5)).toBe('loader')
  })

  it('shows the options once the loader has left', () => {
    expect(listLookOf(true, null, 2)).toBe('options')
  })

  it('closes the window when the read brought no values', () => {
    expect(listLookOf(true, null, 0)).toBe('closed')
  })
})
