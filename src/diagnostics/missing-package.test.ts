import { describe, expect, it } from 'vitest'
import { missingPackageLine, missingPackageOf } from './missing-package.js'

const notFound = (message: string, code = 'ERR_MODULE_NOT_FOUND') => Object.assign(new Error(message), { code })

describe('missingPackageOf', () => {
  it('names the package an import could not find', () => {
    expect(missingPackageOf(notFound("Cannot find package 'undici' imported from D:\\even-keel\\src\\fetch-dispatcher.ts"))).toBe('undici')
    expect(missingPackageOf(notFound("Cannot find package '@scope/name' imported from /srv/even-keel/src/x.ts"))).toBe('@scope/name')
  })

  it('leaves a missing file of the project and any other error alone', () => {
    expect(missingPackageOf(notFound("Cannot find module '/srv/even-keel/src/gone.js' imported from /srv/even-keel/src/main.ts"))).toBeUndefined()
    expect(missingPackageOf(notFound("Cannot find package 'undici'", 'ERR_OTHER'))).toBeUndefined()
    expect(missingPackageOf(new Error('boom'))).toBeUndefined()
    expect(missingPackageOf('text')).toBeUndefined()
  })
})

describe('missingPackageLine', () => {
  it('says which package is missing and what to run where', () => {
    expect(missingPackageLine('undici', '/srv/even-keel')).toBe(
      'even-keel cannot start: the package undici is not installed. Run `npm install` in /srv/even-keel, then start it again',
    )
  })
})
