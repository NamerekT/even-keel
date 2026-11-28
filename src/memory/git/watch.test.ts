import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { watchWhileThere } from './watch.js'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('watchWhileThere', () => {
  const folders: string[] = []
  const closers: (() => void)[] = []

  afterEach(() => {
    for (const close of closers.splice(0)) close()
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  function folder(): string {
    const made = mkdtempSync(join(tmpdir(), 'even-keel-watch-'))
    folders.push(made)
    return made
  }

  it('tells a file written in the folder', async () => {
    const watched = folder()
    const names: (string | null)[] = []
    const watcher = watchWhileThere(watched, {}, (name) => names.push(name))
    closers.push(() => watcher.close())
    await pause(50)
    writeFileSync(join(watched, 'a.md'), 'x')
    await pause(200)
    expect(names).toContain('a.md')
  })

  // On Windows a watcher of a removed folder raises no error and fires ~10^5 change events a second.
  it('goes quiet once the folder is removed', async () => {
    const watched = folder()
    writeFileSync(join(watched, 'a.md'), 'x')
    let told = 0
    const watcher = watchWhileThere(watched, { recursive: true }, () => told++)
    closers.push(() => watcher.close())
    await pause(50)
    rmSync(watched, { recursive: true, force: true })
    await pause(300)
    expect(told).toBeLessThan(10)
  })
})
