import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({ files: [] as string[] }))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  const readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
    reads.files.push(String(path))
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest)
  }) as typeof fs.readFileSync
  return { ...fs, readFileSync, default: { ...fs, readFileSync } }
})

const { folderVendor, keyOf, readAuth, replaceKey, writeKey } = await import('./home.js')

describe('the auth.json of an OpenCode folder as read (BTN-1475)', () => {
  let dir: string
  let file: string
  const readsOfAuth = () => reads.files.filter((path) => path === file).length

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'even-keel-opencode-'))
    file = join(dir, 'data', 'opencode', 'auth.json')
    reads.files = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is read once while its size and time stay', () => {
    writeKey(dir, 'sk-proj-fake.example.com.0000')
    expect(keyOf(dir)).toBe('sk-proj-fake.example.com.0000')
    expect(folderVendor(dir)).toBe('openai')
    expect(keyOf(dir)).toBe('sk-proj-fake.example.com.0000')
    expect(readsOfAuth()).toBe(1)
  })

  it('is read anew after a write from outside, and is gone once the file is', () => {
    writeKey(dir, 'sk-proj-fake.example.com.0000')
    expect(keyOf(dir)).toBe('sk-proj-fake.example.com.0000')
    writeFileSync(file, JSON.stringify({ anthropic: { type: 'api', key: 'sk-ant-fake-example-1' } }))
    expect(keyOf(dir)).toBe('sk-ant-fake-example-1')
    rmSync(file)
    expect(readAuth(dir)).toBeUndefined()
  })

  it('is read anew after replaceKey, though the new key leaves the size and the time as they were', () => {
    writeKey(dir, 'sk-proj-fake.example.com.0000')
    const before = statSync(file)
    expect(keyOf(dir)).toBe('sk-proj-fake.example.com.0000')
    replaceKey(dir, 'sk-proj-fake.example.com.1111')
    utimesSync(file, before.atime, before.mtime)
    expect(keyOf(dir)).toBe('sk-proj-fake.example.com.1111')
  })
})
