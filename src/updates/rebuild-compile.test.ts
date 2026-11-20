import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')

/** The specifiers a module imports at run time: `import type` is erased and does not count. */
function valueImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of source.matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*?\s+from\s+'([^']+)'/gm)) {
    if (match[2] === undefined) found.push(match[3]!)
  }
  for (const match of source.matchAll(/import\(\s*'([^']+)'\s*\)/g)) found.push(match[1]!)
  return found
}

// BTN-1239: a dependency added by a merged task is not installed yet when the rebuild starts, so the one compile
// before the update process installs it must not need any package.
describe('the compile rebuild.ps1 runs before the update process', () => {
  it.each(['rebuild.ps1', 'rebuild.sh'])('%s compiles only the update process, never the whole project', (name) => {
    const script = readFileSync(join(root, 'service', name), 'utf8')
    const compiles = script.split('\n').filter((line) => /\btsc\b/.test(line) && !line.trim().startsWith('#'))
    expect(compiles.length).toBeGreaterThan(0)
    for (const line of compiles) expect(line).toMatch(/-p tsconfig\.updates\.json\b/)
    expect(script.indexOf('tsconfig.updates.json')).toBeLessThan(script.indexOf('run.js rebuild'))
  })

  it('takes run.ts and what it imports, without type checking: a missing package fails nothing', () => {
    const config = JSON.parse(readFileSync(join(root, 'tsconfig.updates.json'), 'utf8')) as {
      include?: unknown[]
      files?: string[]
      compilerOptions?: { noCheck?: boolean }
    }
    expect(config.include).toEqual([])
    expect(config.files).toEqual(['src/updates/run.ts'])
    expect(config.compilerOptions?.noCheck).toBe(true)
  })

  it('leaves an update process that imports only node:* and its own folder at run time', () => {
    const seen = new Set<string>()
    const outside: string[] = []
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const specifier of valueImports(file)) {
        if (specifier.startsWith('node:')) continue
        if (!specifier.startsWith('./')) {
          outside.push(`${file}: ${specifier}`)
          continue
        }
        visit(join(dirname(file), specifier.replace(/\.js$/, '.ts')))
      }
    }
    visit(join(here, 'run.ts'))
    expect(seen.size).toBeGreaterThan(3)
    expect(outside).toEqual([])
  })
})
