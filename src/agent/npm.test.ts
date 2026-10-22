import { describe, expect, it } from 'vitest'
import { npmDist } from './npm.js'

describe('npmDist', () => {
  const meta = {
    name: '@openai/codex',
    version: '0.162.1-win32-x64',
    dist: { tarball: 'https://registry.npmjs.org/@openai/codex/-/codex-0.162.1-win32-x64.tgz', integrity: 'sha512-dfl4MhHuEi0A==' },
  }

  it('takes the tarball and its sha512', () => {
    expect(npmDist(meta, '0.162.1-win32-x64')).toEqual({ tarball: meta.dist.tarball, sha512: 'dfl4MhHuEi0A==' })
  })

  it('refuses another version, a tarball off the registry or no sha512', () => {
    expect(() => npmDist(meta, '0.162.2-win32-x64')).toThrow(/0.162.1-win32-x64/)
    expect(() => npmDist({ ...meta, dist: { ...meta.dist, tarball: 'https://example.com/codex.tgz' } }, '0.162.1-win32-x64')).toThrow(/example.com/)
    expect(() => npmDist({ ...meta, dist: { ...meta.dist, integrity: 'sha1-abc' } }, '0.162.1-win32-x64')).toThrow(/sha512/)
    expect(() => npmDist(null, '0.162.1-win32-x64')).toThrow()
  })
})
