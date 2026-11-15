import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { databaseVersion } from '../storage/database.js'
import { DatabaseMachineStore, KEPT_COMMANDS, MACHINE_STEPS, openMachineDatabase } from './machine-store.js'

describe("the machine's own database", { timeout: 120_000 }, () => {
  let db: PGlite | undefined
  const folders: string[] = []

  const opened = async (dataDir?: string) => {
    db = await openMachineDatabase(dataDir)
    return new DatabaseMachineStore(db)
  }

  afterEach(async () => {
    await db?.close()
    db = undefined
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  it('numbers the events in order and keeps them until the hub took them', async () => {
    const store = await opened()
    expect(await databaseVersion(db!)).toBe(2 + MACHINE_STEPS.length)
    expect(await store.appendEvent('example.started', 10, { task: 'ABC-1' })).toEqual({ seq: 1, type: 'example.started', at: 10, payload: { task: 'ABC-1' } })
    expect(await store.appendEvent('example.idle', 11)).toEqual({ seq: 2, type: 'example.idle', at: 11 })
    await store.appendEvent('example.done', 12)
    expect((await store.eventsAfter(0, 2)).map((event) => event.seq)).toEqual([1, 2])
    await store.dropEvents(2)
    expect(await store.eventsAfter(0, 10)).toEqual([{ seq: 3, type: 'example.done', at: 12 }])
    await store.dropEvents(3)
    expect((await store.appendEvent('example.next', 13)).seq).toBe(4)
  })

  it('numbers on past what the hub has already taken when its own counter is behind', async () => {
    const store = await opened()
    await store.dropEvents(7)
    expect((await store.appendEvent('example.started', 1)).seq).toBe(8)
    await store.dropEvents(5)
    expect((await store.appendEvent('example.idle', 2)).seq).toBe(9)
  })

  it('takes a command number once and names the ones never finished', async () => {
    const store = await opened()
    expect(await store.lastCommand()).toBe(0)
    expect(await store.commandReceived(1, 10)).toBe(true)
    expect(await store.commandReceived(1, 11)).toBe(false)
    expect(await store.commandReceived(2, 12)).toBe(true)
    await store.commandDone(1, 13)
    expect(await store.unfinishedCommands()).toEqual([2])
    expect(await store.lastCommand()).toBe(2)
    await store.commandDone(2, 14)
    expect(await store.commandReceived(2 + KEPT_COMMANDS, 15)).toBe(true)
    expect(await store.commandReceived(1, 16)).toBe(false)
    const { rows } = await db!.query<{ seq: string }>('select seq from commands order by seq')
    expect(rows.map((row) => Number(row.seq))).toEqual([2 + KEPT_COMMANDS])
  })

  it('keeps the agreed projects and folders', async () => {
    const store = await opened()
    await store.agree('project-a', 'C:/repos/a')
    await store.agree('project-a', 'C:/repos/a')
    await store.agree('project-a', 'C:/repos/a-second')
    await store.agree('project-b', 'C:/repos/b')
    await store.withdraw('project-a', 'C:/repos/a-second')
    expect(await store.consents()).toEqual([{ project: 'project-a', folder: 'C:/repos/a' }, { project: 'project-b', folder: 'C:/repos/b' }])
    await store.withdraw('project-a')
    expect(await store.consents()).toEqual([{ project: 'project-b', folder: 'C:/repos/b' }])
  })

  it('finds everything again after a restart', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'even-keel-machine-'))
    folders.push(folder)
    let store = await opened(folder)
    await store.appendEvent('example.started', 1)
    await store.commandReceived(4, 2)
    await store.agree('project-a', 'C:/repos/a')
    await db!.close()
    store = await opened(folder)
    expect((await store.eventsAfter(0, 10)).map((event) => event.seq)).toEqual([1])
    expect((await store.appendEvent('example.idle', 3)).seq).toBe(2)
    expect(await store.unfinishedCommands()).toEqual([4])
    expect(await store.commandReceived(4, 5)).toBe(false)
    expect(await store.consents()).toEqual([{ project: 'project-a', folder: 'C:/repos/a' }])
  })
})
