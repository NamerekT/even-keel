import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { root } from '../locations.js'

// A fresh process: the CommonJS cache is shared by every test file of a worker.
function loadedAfter(script: string): string[] {
  const probe = `${script}
const { createRequire } = await import('node:module')
const cache = createRequire(import.meta.url).cache
console.log(JSON.stringify(Object.keys(cache).filter((file) => file.includes('@hcengineering'))))`
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8', windowsHide: true })
  return JSON.parse(output.trim().split('\n').at(-1)!) as string[]
}

describe('the Huly client', () => {
  const modules = ['./src/tracker/adapters.ts', './src/huly/source.ts', './src/huly/profile.ts', './tally/src/steps.ts']

  it('is not loaded by importing the modules that reach Huly', () => {
    expect(loadedAfter(modules.map((file) => `await import('${file}')`).join('\n'))).toEqual([])
  }, 60_000)

  it('is loaded on the first connection', () => {
    const script = `const { connectHuly } = await import('./src/huly/source.ts')
await connectHuly({ url: 'http://127.0.0.1:1', workspace: 'w', token: 't' }, 1000).catch(() => undefined)`
    expect(loadedAfter(script).length).toBeGreaterThan(0)
  }, 60_000)
})
