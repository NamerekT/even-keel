import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ownServers, resolveCopilotBinary, sessionOf, turnArgs, turnEnded } from './cli.js'

const place = { cwd: 'C:\\work\\demo', dirs: ['C:\\work\\main'], disabled: [], remotes: [] }

describe('turnArgs', () => {
  it('gives a new session its id and its task as the name, and resumes one by its id', () => {
    const fresh = turnArgs({ name: 'DEMO-1', model: 'auto' }, 'DEMO-1', place, { id: 'abc', resume: false })
    expect(fresh).toEqual([
      '-C',
      'C:\\work\\demo',
      '--output-format',
      'json',
      '--no-auto-update',
      '--no-ask-user',
      '--allow-all-tools',
      '--session-id',
      'abc',
      '--name',
      'DEMO-1',
      '--model',
      'auto',
      '--add-dir',
      'C:\\work\\main',
      '--prompt=DEMO-1',
    ])
    const resumed = turnArgs({ name: 'DEMO-1', model: null }, 'go on', place, { id: 'abc', resume: true })
    expect(resumed).toContain('--resume=abc')
    expect(resumed).not.toContain('--session-id')
    expect(resumed).not.toContain('--model')
  })

  it('keeps a prompt that starts with a dash, as a reply does, from being read as an option', () => {
    expect(turnArgs({ name: 'DEMO-1', model: null }, '- "Q" → yes', place, { id: 'abc', resume: true }).at(-1)).toBe('--prompt=- "Q" → yes')
  })

  it("turns the built-in and the project's servers off and puts the gateway's in their place", () => {
    const server = { name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/huly' }
    const args = turnArgs({ name: 'DEMO-1', model: null, mcp: [server] }, 'DEMO-1', { ...place, disabled: ['local-db'] }, { id: 'abc', resume: false })
    expect(args).toContain('--disable-builtin-mcps')
    expect(args.slice(args.indexOf('--disable-mcp-server'), args.indexOf('--disable-mcp-server') + 2)).toEqual(['--disable-mcp-server', 'local-db'])
    const config = JSON.parse(args[args.indexOf('--additional-mcp-config') + 1]!)
    expect(config).toEqual({ mcpServers: { plugin_huly_huly: { type: 'http', url: server.url, tools: ['*'] } } })
  })

  it("leaves the agent's own servers alone when the project has no packages, and passes plugins as folders", () => {
    const plugin = { dir: 'C:\\cache\\checkpoint', name: 'checkpoint', marketplace: 'ek-1', marketplaceFile: 'x', servers: [] }
    const args = turnArgs({ name: 'DEMO-1', model: null, plugins: [plugin] }, 'DEMO-1', place, { id: 'abc', resume: false })
    expect(args).not.toContain('--disable-builtin-mcps')
    expect(args.slice(args.indexOf('--plugin-dir'), args.indexOf('--plugin-dir') + 2)).toEqual(['--plugin-dir', plugin.dir])
  })
})

describe('ownServers', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  })

  it("lists the servers of the project's files, the account's config and the plugins", () => {
    dir = mkdtempSync(join(tmpdir(), 'copilot-'))
    const cwd = join(dir, 'repo')
    const home = join(dir, 'home')
    mkdirSync(join(cwd, '.github'), { recursive: true })
    mkdirSync(join(cwd, '.vscode'), { recursive: true })
    mkdirSync(home, { recursive: true })
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { db: {} } }))
    writeFileSync(join(cwd, '.github', 'mcp.json'), JSON.stringify({ mcpServers: { docs: {} } }))
    writeFileSync(join(cwd, '.vscode', 'mcp.json'), JSON.stringify({ servers: { browser: {} } }))
    writeFileSync(join(home, 'mcp-config.json'), JSON.stringify({ mcpServers: { db: {}, mail: {} } }))
    const plugin = { dir: '', name: 'huly', marketplace: '', marketplaceFile: '', servers: ['huly'] }
    expect(ownServers(cwd, home, [plugin]).sort()).toEqual(['browser', 'db', 'docs', 'huly', 'mail'])
  })
})

describe('turn output', () => {
  const result = JSON.stringify({ type: 'result', timestamp: '2026-10-22T10:00:09.000Z', sessionId: 'abc', exitCode: 0, usage: { premiumRequests: 1 } })
  const progress = JSON.stringify({ type: 'assistant.turn_start', data: { turnId: '0' } })

  it('ignores stderr after the last JSON event', () => {
    expect(turnEnded(`${result}\nERROR cleanup\n`)).toBe(true)
    expect(turnEnded(`${result}\n${progress}\nERROR retrying`)).toBe(false)
    expect(turnEnded('ERROR cleanup')).toBe(false)
  })

  it('ends with the result line, which names the session', () => {
    expect(turnEnded(`${progress}\n`)).toBe(false)
    expect(turnEnded(`${progress}\n${result}\n`)).toBe(true)
    expect(sessionOf(`${progress}\n`)).toBeUndefined()
    expect(sessionOf(`${progress}\n${result}\n`)).toBe('abc')
  })
})

describe('resolveCopilotBinary', () => {
  const at = (...files: string[]) => (path: string) => files.includes(path)
  const npm = 'C:\\Users\\john\\AppData\\Roaming\\npm'
  const nested = `${npm}\\node_modules\\@github\\copilot\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`
  const hoisted = `${npm}\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`
  const local = 'C:\\Users\\john\\AppData\\Local'

  it('takes the variable, then the checked copy, and elsewhere than Windows the bare name', () => {
    expect(resolveCopilotBinary({ EVEN_KEEL_COPILOT_BIN: 'C:\\tools\\copilot.exe' }, 'C:\\copy\\copilot.exe', 'win32', 'x64', at())).toBe('C:\\tools\\copilot.exe')
    expect(resolveCopilotBinary({}, 'C:\\copy\\copilot.exe', 'win32', 'x64', at())).toBe('C:\\copy\\copilot.exe')
    expect(resolveCopilotBinary({ PATH: '/usr/bin' }, undefined, 'linux', 'x64', at('/usr/lib/node_modules/@github/copilot-linux-x64/copilot'))).toBe('copilot')
  })

  it('finds the native copilot.exe of an npm install next to its wrapper on the PATH, nested or hoisted', () => {
    const env = { Path: `C:\\Windows;${npm}` }
    expect(resolveCopilotBinary(env, undefined, 'win32', 'x64', at(nested))).toBe(nested)
    expect(resolveCopilotBinary(env, undefined, 'win32', 'x64', at(hoisted))).toBe(hoisted)
    const arm = `${npm}\\node_modules\\@github\\copilot\\node_modules\\@github\\copilot-win32-arm64\\copilot.exe`
    expect(resolveCopilotBinary(env, undefined, 'win32', 'arm64', at(arm))).toBe(arm)
  })

  it('looks into the npm folder of APPDATA when the PATH does not name it', () => {
    expect(resolveCopilotBinary({ APPDATA: 'C:\\Users\\john\\AppData\\Roaming', PATH: 'C:\\Windows' }, undefined, 'win32', 'x64', at(nested))).toBe(nested)
  })

  it('puts winget before npm and falls back to the bare name', () => {
    const link = `${local}\\Microsoft\\WinGet\\Links\\copilot.exe`
    expect(resolveCopilotBinary({ LOCALAPPDATA: local, PATH: npm }, undefined, 'win32', 'x64', at(link, nested))).toBe(link)
    expect(resolveCopilotBinary({ LOCALAPPDATA: local, PATH: npm }, undefined, 'win32', 'x64', at(`${npm}\\copilot`, `${npm}\\copilot.cmd`))).toBe('copilot')
  })
})
