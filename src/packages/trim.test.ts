import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkServer, neededOf, trimOf, writeTrim } from './trim.js'

let dir: string | undefined
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function temp(): string {
  dir = mkdtempSync(join(tmpdir(), 'even-keel-trim-'))
  return dir
}

describe('trimOf', () => {
  it('has a list only for the Huly server', () => {
    expect(trimOf('@firfi/huly-mcp')?.drop).toContain('@hcengineering/ui')
    expect(trimOf('example-mcp')).toBeUndefined()
  })
})

describe('writeTrim', () => {
  it('overrides each listed package with a stub that throws with its name', () => {
    const prefix = temp()
    writeTrim(prefix, '@firfi/huly-mcp', ['@hcengineering/ui', 'svelte'])
    const manifest = JSON.parse(readFileSync(join(prefix, 'package.json'), 'utf8')) as { overrides: Record<string, string> }
    expect(Object.keys(manifest.overrides)).toEqual(['@hcengineering/ui', 'svelte'])
    const require = createRequire(join(prefix, 'index.js'))
    for (const spec of Object.values(manifest.overrides)) {
      const stub = join(prefix, spec.replace(/^file:/, ''))
      let message = ''
      try {
        require(stub)
      } catch (error) {
        message = (error as Error).message
      }
      const name = (JSON.parse(readFileSync(join(stub, 'package.json'), 'utf8')) as { name: string }).name
      expect(neededOf(message)).toBe(name)
      expect(message).toContain('@firfi/huly-mcp')
    }
  })
})

describe('checkServer', () => {
  const server = (body: string) => {
    const file = join(temp(), 'server.cjs')
    writeFileSync(file, body)
    return { command: 'node', args: [file] }
  }

  it('passes a server that answers initialize and tools/list', async () => {
    const entry = server(`
      require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (message.id === undefined) return
        const result = message.method === 'tools/list' ? { tools: [] } : { protocolVersion: '2025-06-18', capabilities: {} }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
      })`)
    expect(await checkServer(entry, {}, {})).toBeNull()
  })

  it('reports the stub a server fell on', async () => {
    const entry = server(`throw new Error(${JSON.stringify('svelte is not installed: Even Keel left it out of @firfi/huly-mcp')})`)
    const reason = await checkServer(entry, {}, {})
    expect(neededOf(reason ?? '')).toBe('svelte')
  })

  it('fails a server that answers with an error and gives it the check environment', async () => {
    const entry = server(`
      require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const message = JSON.parse(line)
        if (message.id === undefined) return
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -1, message: 'url ' + process.env.EXAMPLE_URL } }) + '\\n')
      })`)
    expect(await checkServer(entry, {}, { EXAMPLE_URL: 'http://127.0.0.1:9' })).toBe('initialize failed: url http://127.0.0.1:9')
  })
})
