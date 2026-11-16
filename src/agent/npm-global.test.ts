import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { forgetNpmBinaries, NPM_BINARY_TTL_MS, npmCliBinary, npmGlobalModules, type NpmCli } from './npm-global.js'

const runnable = (...files: string[]) => (path: string) => files.includes(path)

describe('npmGlobalModules', () => {
  it('takes on Windows the node_modules beside each PATH folder and the npm folder of APPDATA', () => {
    const env = { Path: 'C:\\Windows;D:\\tools\\npm', APPDATA: 'C:\\Users\\john\\AppData\\Roaming' }
    expect(npmGlobalModules(env, 'win32')).toEqual([
      'C:\\Windows\\node_modules',
      'D:\\tools\\npm\\node_modules',
      'C:\\Users\\john\\AppData\\Roaming\\npm\\node_modules',
    ])
  })

  it('takes elsewhere the lib/node_modules of each PATH folder\'s prefix, once each', () => {
    expect(npmGlobalModules({ PATH: '/usr/local/bin:/home/john/.nvm/versions/node/v24.1.0/bin:/usr/local/bin' }, 'linux')).toEqual([
      '/usr/local/lib/node_modules',
      '/home/john/.nvm/versions/node/v24.1.0/lib/node_modules',
    ])
  })
})

describe('npmCliBinary', () => {
  const cli: NpmCli = {
    wrapper: '@scope/tool',
    bin: 'bin/tool.exe',
    natives: [{ pkg: '@scope/tool-linux-x64', file: 'tool' }, { pkg: '@scope/tool-linux-x64-musl', file: 'tool' }],
  }
  const env = { PATH: '/usr/bin:/usr/local/bin' }
  const modules = '/usr/local/lib/node_modules'
  const wrapperBin = `${modules}/@scope/tool/bin/tool.exe`
  const nested = `${modules}/@scope/tool/node_modules/@scope/tool-linux-x64/tool`
  const hoisted = `${modules}/@scope/tool-linux-x64/tool`
  const musl = `${modules}/@scope/tool/node_modules/@scope/tool-linux-x64-musl/tool`

  it('takes the wrapper\'s bin once the postinstall has put the native binary there', () => {
    expect(npmCliBinary(cli, env, 'linux', runnable(wrapperBin, nested))).toBe(wrapperBin)
  })

  it('takes the platform package\'s binary, nested or hoisted, when the bin is still the placeholder', () => {
    expect(npmCliBinary(cli, env, 'linux', runnable(nested))).toBe(nested)
    expect(npmCliBinary(cli, env, 'linux', runnable(hoisted))).toBe(hoisted)
    expect(npmCliBinary(cli, env, 'linux', runnable(musl))).toBe(musl)
  })

  it('finds nothing without an npm install', () => {
    expect(npmCliBinary(cli, env, 'linux', runnable())).toBeUndefined()
    expect(npmCliBinary(cli, {}, 'linux', runnable(nested))).toBeUndefined()
  })

  it('joins Windows paths with backslashes', () => {
    const win: NpmCli = { wrapper: '@scope/tool', bin: 'bin/tool.exe', natives: [{ pkg: '@scope/tool-win32-x64', file: 'tool.exe' }] }
    const native = 'C:\\Users\\john\\AppData\\Roaming\\npm\\node_modules\\@scope\\tool\\node_modules\\@scope\\tool-win32-x64\\tool.exe'
    expect(npmCliBinary(win, { APPDATA: 'C:\\Users\\john\\AppData\\Roaming', PATH: 'C:\\Windows' }, 'win32', runnable(native))).toBe(native)
  })

  it('keeps a search of the disk for a while, so the machine\'s facts do not read every path on each pass', () => {
    forgetNpmBinaries()
    const root = mkdtempSync(join(tmpdir(), 'npm-global-'))
    try {
      const own: NpmCli = { wrapper: 'tool', bin: 'tool.js', natives: [] }
      const ownEnv = process.platform === 'win32' ? { Path: root } : { PATH: join(root, 'bin') }
      const modules = npmGlobalModules(ownEnv)[0]!
      const bin = join(modules, 'tool', 'tool.js')
      mkdirSync(join(modules, 'tool'), { recursive: true })
      writeFileSync(bin, '')
      let now = 1_000
      expect(npmCliBinary(own, ownEnv, process.platform, undefined, () => now)).toBe(bin)
      rmSync(bin)
      now += NPM_BINARY_TTL_MS - 1
      expect(npmCliBinary(own, ownEnv, process.platform, undefined, () => now)).toBe(bin)
      now += 1
      expect(npmCliBinary(own, ownEnv, process.platform, undefined, () => now)).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
      forgetNpmBinaries()
    }
  })
})
