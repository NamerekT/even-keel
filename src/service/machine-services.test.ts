import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { fromCarried } from '../machine/services.js'
import { wireMachineServices, type MachineServicesContext } from './machine-services.js'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function rig(workdir: string | null) {
  const home: AccountHome = { key: 'global', dir: '/account', global: true, agent: 'claude' }
  const agent = {
    feed: async () => ({ lines: [] }),
    record: async (_home: AccountHome, sessionId: string) => ({ sessionId, workdir }),
  }
  const services = wireMachineServices({
    homes: { list: () => [home] },
    inHomes: async (find: (home: AccountHome) => Promise<unknown>) => find(home),
    agentOf: () => agent,
    mailbox: { delivered: () => [] },
    configStore: { current: {} },
    promptLanguage: () => 'en',
    taskNote: () => undefined,
  } as unknown as MachineServicesContext, { steer: async () => false, restore: async () => {} })
  return services.transcript
}

function sessionFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-file-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.temp', 'inbox'), { recursive: true })
  writeFileSync(join(dir, '.temp', 'inbox', 'order.png'), 'picture')
  writeFileSync(join(dir, 'secret.png'), 'secret')
  return dir
}

describe('inboxFile', () => {
  it('gives a picture of the session inbox that its transcript does not name yet', async () => {
    const transcript = rig(sessionFolder())
    const found = await transcript.inboxFile('session-1', 'order.png')
    expect(found?.type).toBe('image/png')
    expect(Buffer.from(fromCarried(found!)).toString()).toBe('picture')
  })

  it('refuses a name with a folder, a missing file and a session without a folder', async () => {
    const transcript = rig(sessionFolder())
    expect(await transcript.inboxFile('session-1', '../../secret.png')).toBeUndefined()
    expect(await transcript.inboxFile('session-1', '..\\..\\secret.png')).toBeUndefined()
    expect(await transcript.inboxFile('session-1', 'other.png')).toBeUndefined()
    expect(await rig(null).inboxFile('session-1', 'order.png')).toBeUndefined()
  })
})
