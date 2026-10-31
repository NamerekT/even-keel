import { describe, expect, it } from 'vitest'
import { LOADER_MS, loaderStep } from './loaderPhase.js'

describe('loaderStep', () => {
  it('shows nothing while there is nothing to wait for', () => {
    expect(loaderStep('done', false)).toBeNull()
  })

  it('starts with the entrance once loading begins', () => {
    expect(loaderStep('done', true)).toEqual({ next: 'in', after: 0 })
  })

  it('plays the entrance and the shortest stay whatever the data does', () => {
    for (const busy of [true, false]) {
      expect(loaderStep('in', busy)).toEqual({ next: 'stay', after: LOADER_MS.in })
      expect(loaderStep('stay', busy)).toEqual({ next: 'wait', after: LOADER_MS.stay })
    }
  })

  it('waits as long as loading goes on, then leaves', () => {
    expect(loaderStep('wait', true)).toBeNull()
    expect(loaderStep('wait', false)).toEqual({ next: 'out', after: 0 })
  })

  it('finishes the exit before the content shows', () => {
    expect(loaderStep('out', false)).toEqual({ next: 'done', after: LOADER_MS.out })
    expect(loaderStep('out', true)).toEqual({ next: 'done', after: LOADER_MS.out })
  })

  it('is on screen at least the entrance, the stay and the exit', () => {
    expect(LOADER_MS.in + LOADER_MS.stay + LOADER_MS.out).toBeGreaterThanOrEqual(200)
  })
})
