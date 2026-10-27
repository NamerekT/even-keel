import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SdkRegistry } from '../claude/sdk/registry.js'
import { TurnRegistry } from '../codex/turns.js'

vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(),
  // Start list's reads on the next microtask, so the real readFile is in flight before the write.
  readdir: async (dir: string) => readdirSync(dir),
}))

const session = {
  sessionId: 'example-session', name: 'ABC-1', cwd: 'C:/repos/example', account: 'example', startedAt: 1,
  pid: 42, out: 'turn.jsonl', executor: 43, pipe: 'example-pipe', model: null,
}

describe.each([['Codex', TurnRegistry], ['SDK', SdkRegistry]] as const)('%s atomic readers', (_name, Registry) => {
  let dir: string

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function registry() {
    mkdirSync('.temp', { recursive: true })
    dir = mkdtempSync(join('.temp', 'registry-read-'))
    return new Registry(dir)
  }

  it('ignores missing, malformed and other-account sessions', async () => {
    const store = registry()
    expect(await store.list('example')).toEqual([])
    expect(await store.get('missing')).toBeUndefined()
    store.save(session)
    store.save({ ...session, sessionId: 'other', account: 'other' })
    writeFileSync(join(dir, 'sessions', 'broken.json'), '{')
    expect(await store.get('broken')).toBeUndefined()
    expect(await store.get('../example-session')).toBeUndefined()
    expect(await store.list('example')).toMatchObject([{ sessionId: session.sessionId }])
  })

  it.skipIf(process.platform !== 'win32').each(['get', 'list'] as const)(
    'does not hold a session file across a concurrent save during %s', async (method) => {
      const store = registry()
      store.save(session)
      const reading = method === 'get' ? store.get(session.sessionId) : store.list(session.account)
      await Promise.resolve()
      await Promise.resolve()
      // Give an async open time to finish in the thread pool while its close still needs the event loop.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      try {
        store.save({ ...session, name: 'ABC-2' })
      } finally {
        await reading
      }
      expect(await store.get(session.sessionId)).toMatchObject({ name: 'ABC-2' })
    },
  )
})
