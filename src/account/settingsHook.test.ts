import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shareConfig } from './share.js'

const hook = resolve('src/account/settingsHook.ts')
const uninstall = resolve('src/account/settingsUninstall.ts')

function run(script: string, args: string[], input: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), script, ...args], { cwd, env, windowsHide: true, stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    child.on('error', reject)
    child.on('close', (code) => done({ stdout, stderr, code }))
    child.stdin.end(input)
  })
}

describe('account settings hook entry points', () => {
  let root: string
  let server: Server
  let url: string
  let calls: number
  let status: number
  let hang: boolean
  const input = (file: string) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file } })
  const args = () => ['--even-keel-account-settings', Buffer.from(JSON.stringify({ accountsDir: root, globalDir: join(root, 'global'), url })).toString('base64url')]

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'even-keel-hook-'))
    calls = 0
    status = 200
    hang = false
    server = createServer((_request, response) => {
      calls++
      if (hang) return
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ account: { accounts: [{ key: 'example', agent: 'claude', global: false }] } }))
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address() as { port: number }
    url = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))
    rmSync(root, { recursive: true, force: true })
  })

  it('prints a Claude denial on stdout, from an unrelated working directory', async () => {
    const result = await run(hook, args(), input(join(root, 'example', 'settings.json')), root)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' })
    expect(calls).toBe(1)
  })

  it('does no HTTP for other files or malformed input, and emits no allow decision', async () => {
    for (const value of [input(join(root, 'file.ts')), '{broken', '{}']) {
      expect(await run(hook, args(), value, root)).toEqual({ stdout: '', stderr: '', code: 0 })
    }
    expect(calls).toBe(0)
    status = 503
    expect(await run(hook, args(), input(join(root, 'example', 'settings.json')), root)).toEqual({ stdout: '', stderr: '', code: 0 })
  })

  it('uninstalls using the data folder environment, preserving user hooks and settings', async () => {
    const global = join(root, 'global')
    const accounts = join(root, 'accounts')
    const folder = join(accounts, 'example')
    mkdirSync(global)
    writeFileSync(join(global, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo user' }] }] } }))
    shareConfig({ dir: global, config: join(root, '.claude.json') }, folder)
    writeFileSync(join(root, '.env'), `EVEN_KEEL_ACCOUNTS_DIR=${JSON.stringify(accounts.replaceAll('\\', '/'))}\n`)
    const env = { ...process.env, EVEN_KEEL_DATA: root, CLAUDE_CONFIG_DIR: global }
    delete env.EVEN_KEEL_ACCOUNTS_DIR
    const result = await run(uninstall, [], '', root, env)
    expect(result).toEqual({ stdout: '', stderr: '', code: 0 })
    expect(readFileSync(join(folder, 'settings.json'), 'utf8')).not.toContain('--even-keel-account-settings')
    expect(JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8')).hooks.Stop).toHaveLength(1)
  })

  it('allows a settings edit when the service never answers', async () => {
    hang = true
    expect(await run(hook, args(), input(join(root, 'example', 'settings.json')), root)).toEqual({ stdout: '', stderr: '', code: 0 })
    expect(calls).toBe(1)
  })
})
