import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname
const root = join(here, '..', '..')

/** Every module `drawing.ts` reaches through its relative imports, and every non-relative import among them. */
function reached(): { modules: string[]; outside: string[] } {
  const seen = new Set<string>()
  const outside = new Set<string>()
  const queue = ['drawing.ts']
  while (queue.length > 0) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const code = readFileSync(join(here, name), 'utf8')
    for (const match of code.matchAll(/^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      const target = match[1]!
      if (target.startsWith('.')) queue.push(posix.normalize(posix.join(posix.dirname(name), target.replace(/\.js$/, '.ts'))))
      else outside.add(target)
    }
  }
  return { modules: [...seen].sort(), outside: [...outside] }
}

describe('the npm package even-keel-badge (packages/badge)', () => {
  it('holds the drawing alone: no module of the service, no Node and no outside import', () => {
    const { modules, outside } = reached()
    expect(modules).toEqual(['drawing.ts', 'fonts.generated.ts', 'model.ts', 'render.ts', 'text.ts', 'theme.ts'])
    expect(outside).toEqual([])
  })

  it('ships only its build, entered through drawing.ts', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'packages', 'badge', 'package.json'), 'utf8'))
    expect(pkg.name).toBe('even-keel-badge')
    expect(pkg.files).toEqual(['dist'])
    expect(pkg.exports['.']).toEqual({ types: './dist/drawing.d.ts', default: './dist/drawing.js' })
    expect(pkg.dependencies).toBeUndefined()
  })

  it('is what the Worker depends on', () => {
    const worker = JSON.parse(readFileSync(join(root, 'deploy', 'badge', 'package.json'), 'utf8'))
    expect(worker.name).not.toBe('even-keel-badge')
    expect(worker.dependencies).toEqual({ 'even-keel-badge': 'latest' })
  })
})
