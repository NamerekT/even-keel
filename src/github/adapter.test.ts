import { describe, expect, it } from 'vitest'
import { parseRemote } from '../ci/remote.js'
import { github } from './adapter.js'

describe('github.projectOfRemote', () => {
  it('takes owner/name of a github.com remote, by https or ssh', () => {
    expect(github.projectOfRemote!(parseRemote('https://github.com/octo-org/storefront.git')!)).toBe('octo-org/storefront')
    expect(github.projectOfRemote!(parseRemote('git@github.com:octo-org/storefront.git')!)).toBe('octo-org/storefront')
  })

  it('takes no other host', () => {
    expect(github.projectOfRemote!(parseRemote('https://git.example.com/octo-org/storefront.git')!)).toBeUndefined()
  })
})
