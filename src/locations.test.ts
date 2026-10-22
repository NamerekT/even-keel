import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataDirOf, homeOf, packageRoot, sourceOf } from './locations.js'

const only = (...paths: string[]) => (path: string) => paths.includes(path)

describe('packageRoot', () => {
  const checkout = resolve('/work/even-keel')

  it('finds the root from the sources and from the build alike', () => {
    const exists = only(join(checkout, 'package.json'))
    expect(packageRoot(join(checkout, 'src'), exists)).toBe(checkout)
    expect(packageRoot(join(checkout, 'dist', 'src'), exists)).toBe(checkout)
    expect(packageRoot(join(checkout, 'dist', 'tally', 'src'), exists)).toBe(checkout)
  })

  it('fails with no package.json up to the drive root', () => {
    expect(() => packageRoot(join(checkout, 'src'), () => false)).toThrow(/no package.json/)
  })
})

describe('sourceOf', () => {
  it('tells a checkout by its sources', () => {
    const checkout = resolve('/work/even-keel')
    expect(sourceOf(checkout, only(join(checkout, 'src', 'main.ts')))).toBe('git')
    expect(sourceOf(resolve('/usr/lib/node_modules/even-keel'), () => false)).toBe('npm')
  })
})

describe('homeOf', () => {
  const user = resolve('/home/john')
  const root = resolve('/opt/even-keel')

  it('keeps the data of a checkout in it', () => {
    expect(homeOf(root, 'git', {}, 'linux', user)).toBe(root)
  })

  it('puts the data of a package into the profile', () => {
    expect(homeOf(root, 'npm', {}, 'linux', user)).toBe(join(user, '.local', 'share', 'even-keel'))
  })

  it('takes EVEN_KEEL_DATA over both', () => {
    const chosen = resolve('/data/even-keel')
    expect(homeOf(root, 'npm', { EVEN_KEEL_DATA: chosen }, 'linux', user)).toBe(chosen)
    expect(homeOf(root, 'git', { EVEN_KEEL_DATA: chosen }, 'linux', user)).toBe(chosen)
  })
})

describe('dataDirOf', () => {
  const user = resolve('/Users/john')

  it('follows each platform', () => {
    expect(dataDirOf({ LOCALAPPDATA: join(user, 'Local') }, 'win32', user)).toBe(join(user, 'Local', 'even-keel'))
    expect(dataDirOf({}, 'win32', user)).toBe(join(user, 'AppData', 'Local', 'even-keel'))
    expect(dataDirOf({}, 'darwin', user)).toBe(join(user, 'Library', 'Application Support', 'even-keel'))
    expect(dataDirOf({ XDG_DATA_HOME: join(user, 'data') }, 'linux', user)).toBe(join(user, 'data', 'even-keel'))
  })
})
