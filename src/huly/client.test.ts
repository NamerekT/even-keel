import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { HULY_CLIENT, HulyClient, type HulyClientDeps } from './client.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'huly-client-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Writes each pinned package into the folder as npm would, at `version` or its pinned one. */
function fakeInstall(dir: string, version?: string): void {
  for (const [name, pinned] of Object.entries(HULY_CLIENT)) {
    const home = join(dir, 'node_modules', ...name.split('/'))
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'package.json'), JSON.stringify({ name, version: version ?? pinned, main: 'index.js' }))
    writeFileSync(join(home, 'index.js'), `module.exports = { from: ${JSON.stringify(dir)} }`)
  }
}

const missing = (() => {
  throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' })
}) as unknown as NodeJS.Require
Object.assign(missing, { resolve: missing })

function client(overrides: Partial<HulyClientDeps> & { dir: string }): HulyClient {
  return new HulyClient({ own: missing, install: async () => {}, ...overrides, dir: () => overrides.dir })
}

const codeOf = (call: () => unknown): string | undefined => {
  try {
    call()
  } catch (error) {
    return error instanceof NoticeError ? error.notice.code : String(error)
  }
  return undefined
}

describe('HulyClient', () => {
  it('loads the packages the code itself resolves, as a clone has them, and installs nothing', () => {
    const install = vi.fn(async () => {})
    const own = Object.assign((name: string) => ({ own: name }), { resolve: (name: string) => name }) as unknown as NodeJS.Require
    const huly = client({ dir: tempDir(), own, install })
    expect(huly.require('@hcengineering/core')).toEqual({ own: '@hcengineering/core' })
    expect(install).not.toHaveBeenCalled()
    expect(huly.view()).toBeNull()
  })

  it('loads them from the data folder when they are installed there at the pinned versions', () => {
    const dir = tempDir()
    fakeInstall(dir)
    const huly = client({ dir })
    expect(huly.require('@hcengineering/rank')).toEqual({ from: dir })
  })

  it('installs the pinned versions when they are nowhere, and says so until the install is done', async () => {
    const dir = tempDir()
    let finish: () => void = () => {}
    const install = vi.fn((prefix: string) => new Promise<void>((resolve) => (finish = () => (fakeInstall(prefix), resolve()))))
    const changed = vi.fn()
    const huly = client({ dir, install, changed })
    expect(codeOf(() => huly.require('@hcengineering/core'))).toBe('huly.clientInstalling')
    expect(huly.view()?.code).toBe('huly.clientInstalling')
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies).toEqual(HULY_CLIENT)
    expect(codeOf(() => huly.require('@hcengineering/core'))).toBe('huly.clientInstalling')
    expect(install).toHaveBeenCalledTimes(1)
    finish()
    await huly.installed()
    expect(huly.view()).toBeNull()
    expect(huly.require('@hcengineering/core')).toEqual({ from: dir })
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('takes a folder of other versions for none: an update of Even Keel pins new ones', async () => {
    const dir = tempDir()
    fakeInstall(dir, '0.0.1')
    const install = vi.fn(async (prefix: string) => fakeInstall(prefix))
    const huly = client({ dir, install })
    expect(codeOf(() => huly.require('@hcengineering/core'))).toBe('huly.clientInstalling')
    await huly.installed()
    expect(huly.require('@hcengineering/core')).toEqual({ from: dir })
  })

  it('keeps a failed install on the page until it is retried, and does not retry by itself', async () => {
    const dir = tempDir()
    const install = vi.fn(async () => {
      throw new Error('npm ERR! network')
    })
    const huly = client({ dir, install })
    expect(codeOf(() => huly.require('@hcengineering/core'))).toBe('huly.clientInstalling')
    await huly.installed()
    expect(huly.view()).toMatchObject({ code: 'huly.clientFailed', detail: 'npm ERR! network' })
    expect(codeOf(() => huly.require('@hcengineering/core'))).toBe('huly.clientFailed')
    expect(install).toHaveBeenCalledTimes(1)
    install.mockImplementation(async (prefix: string) => fakeInstall(prefix))
    huly.install()
    expect(huly.view()?.code).toBe('huly.clientInstalling')
    await huly.installed()
    expect(huly.view()).toBeNull()
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('installs nothing on a retry when the packages already load', () => {
    const install = vi.fn(async () => {})
    const own = Object.assign(() => ({}), { resolve: (name: string) => name }) as unknown as NodeJS.Require
    client({ dir: tempDir(), own, install }).install()
    expect(install).not.toHaveBeenCalled()
  })
})
