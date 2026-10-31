import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerEntry } from './model.js'

const CHECK_TIMEOUT_MS = 60_000
const STUB = /([\w@./+-]+) is not installed: Even Keel left it out of /

/** Packages a pinned server's install leaves out, and the environment its check after the install runs in. */
export interface Trim {
  drop: string[]
  env: Record<string, string>
}

/**
 * By npm package (BTN-627). The Huly server's plugin packages depend on `@hcengineering/ui`, Huly's web front end, which
 * brings two thirds of the install; the server never loads it. The rest of the list is what `ui` brings, in case a
 * later version depends on it some other way. The check needs no real Huly: the server connects on the first tool call.
 */
const TRIMS: Record<string, Trim> = {
  '@firfi/huly-mcp': {
    drop: [
      '@hcengineering/ui', '@hcengineering/theme', 'svelte', 'plyr', 'date-fns', 'date-fns-tz', 'core-js', 'dompurify', 'autolinker',
      'blurhash', 'css-tree', 'mdn-data', 'acorn', 'aria-query', 'magic-string', 'axobject-query', 'loadjs', 'rangetouch',
    ],
    env: { HULY_URL: 'http://127.0.0.1:9', HULY_EMAIL: 'check@example.com', HULY_PASSWORD: 'check', HULY_WORKSPACE: 'check', DO_NOT_TRACK: '1' },
  },
}

export function trimOf(name: string): Trim | undefined {
  return TRIMS[name]
}

/**
 * The `package.json` of the install folder: npm `overrides` put a stub in place of each dropped package, so npm downloads
 * neither it nor what it depends on. The stub throws on load, naming itself, so a server that does need it fails plainly.
 */
export function writeTrim(prefix: string, server: string, drop: string[]): void {
  const overrides: Record<string, string> = {}
  for (const name of drop) {
    const folder = `stub/${name.replace('/', '+')}`
    mkdirSync(join(prefix, folder), { recursive: true })
    const manifest = { name, version: '0.0.0', main: 'index.js', exports: { '.': './index.js', './*': './index.js' } }
    writeFileSync(join(prefix, folder, 'package.json'), JSON.stringify(manifest))
    const message = `${name} is not installed: Even Keel left it out of ${server}, whose install it trims`
    writeFileSync(join(prefix, folder, 'index.js'), `throw new Error(${JSON.stringify(message)})\n`)
    overrides[name] = `file:./${folder}`
  }
  writeFileSync(join(prefix, 'package.json'), JSON.stringify({ private: true, overrides }, null, 2))
}

/** The dropped package a check's failure names, or `null`. */
export function neededOf(reason: string): string | null {
  return STUB.exec(reason)?.[1] ?? null
}

/**
 * Starts a pinned server the way a session does and asks `initialize` and `tools/list`: `null` once both are answered,
 * otherwise why not. The server is stopped either way.
 */
export function checkServer(entry: ServerEntry, base: NodeJS.ProcessEnv, extra: Record<string, string>): Promise<string | null> {
  const own = Object.fromEntries(Object.entries(entry.env ?? {}).filter(([, value]) => typeof value === 'string')) as Record<string, string>
  const args = Array.isArray(entry.args) ? entry.args.map(String) : []
  const child = spawn(process.execPath, args, { env: { ...base, ...own, ...extra }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    // Node prints the throwing source line before the error itself: the last match is the error.
    const stub = () => err.split('\n').findLast((line) => STUB.test(line))?.trim()
    const finish = (reason: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill()
      resolve(reason === null ? null : (stub() ?? reason))
    }
    const timer = setTimeout(() => finish(`no answer in ${CHECK_TIMEOUT_MS / 1000} s`), CHECK_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
      let end: number
      while ((end = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, end).trim()
        out = out.slice(end + 1)
        let message: { id?: unknown; result?: { tools?: unknown }; error?: { message?: unknown } }
        try {
          message = JSON.parse(line) as typeof message
        } catch {
          continue
        }
        const method = message.id === 1 ? 'initialize' : message.id === 2 ? 'tools/list' : undefined
        if (method === undefined) continue
        if (message.error !== undefined) finish(`${method} failed: ${String(message.error.message)}`)
        else if (method === 'tools/list') finish(Array.isArray(message.result?.tools) ? null : 'tools/list gave no tools')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => (err = (err + chunk.toString('utf8')).slice(-8000)))
    child.on('error', (error) => finish(error.message))
    child.on('exit', (code) => finish(`exited with ${code}${err.trim() === '' ? '' : `: ${err.trim().split('\n').at(-1)}`}`))
    child.stdin.on('error', () => {})
    const initialize = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'even-keel-check', version: '1' } }
    for (const message of [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: initialize },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
      child.stdin.write(`${JSON.stringify(message)}\n`)
  })
}
