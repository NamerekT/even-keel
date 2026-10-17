import { describe, expect, it, vi } from 'vitest'
import { withoutModelNoise } from './quiet.js'

describe('withoutModelNoise', () => {
  it('drops the model transaction warning of the Huly client', () => {
    const warn = vi.fn()
    withoutModelNoise(warn)(
      'no document found, failed to apply model transaction, skipping',
      '_id="tx-1"',
      '_class="core:class:TxUpdateDoc"',
      'objectId="doc-1"',
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes any other warning through with all its arguments', () => {
    const warn = vi.fn()
    const quiet = withoutModelNoise(warn)
    quiet('failed to apply model transaction, skipping', '_id="tx-1"')
    quiet('chain: something went wrong')
    quiet({ message: 'no document found, failed to apply model transaction, skipping' })
    expect(warn.mock.calls).toEqual([
      ['failed to apply model transaction, skipping', '_id="tx-1"'],
      ['chain: something went wrong'],
      [{ message: 'no document found, failed to apply model transaction, skipping' }],
    ])
  })
})
