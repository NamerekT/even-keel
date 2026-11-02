import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HULY_CLIENT, HULY_CLIENT_OVERRIDES } from './huly/client.js'
import { root } from './locations.js'

// The npm package installs only `dependencies`; the page is built into `dist/web`, so its libraries are build tools.
const RUNTIME_DIRS = ['src', 'tally/src', 'tally/bin', 'statusline', 'plugins']
const SOURCE = /\.(ts|mjs|js)$/
const NOT_RUNTIME = /\.test\.(ts|mjs)$|(^|[\\/])fixture\.ts$|\.fixture\.ts$|[\\/]e2e[\\/]/
// Development packages that runtime folders may still load: only tests import `src/storage/memory.ts`, and the rule
// hook runs from a clone's main checkout, never from the npm package.
const DEV_ONLY: Record<string, string> = { vitest: 'src/storage/memory.ts', tsx: 'tally/bin/rule-hook.mjs' }
// Packages whose install outweighs what the service takes from them.
const TOO_HEAVY: Record<string, string> = { '@hcengineering/tracker': 'Huly web UI, ~49 MB and ~12,000 files, for 8 string ids' }
// Installed into the data folder once a Huly profile needs them (`src/huly/client.ts`), never by the npm package.
const ON_DEMAND = new Set(Object.keys(HULY_CLIENT))

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && SOURCE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !NOT_RUNTIME.test(file))
}

function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0])) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

function loadedPackages(root: string): Map<string, string> {
  const loaded = new Map<string, string>()
  const patterns = [
    /^\s*import\s+(?!type\b)[^'"()]*?from\s+'([^']+)'/gm,
    /^\s*import\s+'([^']+)'/gm,
    /^\s*export\s+(?!type\b)[^'"()]*?from\s+'([^']+)'/gm,
    /\brequire\('([^']+)'\)/g,
    /\bimport\('([^']+)'\)/g,
  ]
  for (const file of RUNTIME_DIRS.flatMap((dir) => sources(join(root, dir)))) {
    const text = readFileSync(file, 'utf8')
    const path = relative(root, file).replaceAll('\\', '/')
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const name = packageOf(match[1])
        if (name !== null && DEV_ONLY[name] !== path && !loaded.has(name)) loaded.set(name, path)
      }
    }
  }
  return loaded
}

describe('runtime dependencies', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    overrides: unknown
  }
  const declared = Object.keys(manifest.dependencies)
  const loaded = loadedPackages(root)

  it('declares every package the service loads, but those it installs on demand', () => {
    const missing = [...loaded].filter(([name]) => !declared.includes(name) && !ON_DEMAND.has(name)).map(([name, path]) => `${name} (${path})`)
    expect(missing).toEqual([])
  })

  it('installs the Huly client on demand only, at the versions a clone is tested with', () => {
    expect(declared.filter((name) => name.startsWith('@hcengineering/'))).toEqual([])
    expect([...loaded.keys()].filter((name) => name.startsWith('@hcengineering/') && !ON_DEMAND.has(name))).toEqual([])
    expect(Object.fromEntries(Object.keys(HULY_CLIENT).map((name) => [name, manifest.devDependencies[name]]))).toEqual(HULY_CLIENT)
    expect(manifest.overrides).toEqual(HULY_CLIENT_OVERRIDES)
  })

  it('overrides every Tiptap package the Huly client takes, so none stays at a vulnerable version', () => {
    const text = JSON.parse(readFileSync(join(root, 'node_modules', '@hcengineering', 'text', 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    const patched = HULY_CLIENT_OVERRIDES['@hcengineering/text']
    expect(Object.keys(text.dependencies).filter((name) => name.startsWith('@tiptap/') && !(name in patched))).toEqual([])
    const core = JSON.parse(readFileSync(join(root, 'node_modules', '@tiptap', 'core', 'package.json'), 'utf8')) as { version: string }
    expect(core.version).toBe(patched['@tiptap/core'])
  })

  it('declares nothing the service never loads', () => {
    expect(declared.filter((name) => !loaded.has(name))).toEqual([])
  })

  it('takes Huly tracker ids from src/huly/ids.ts, not from the plugin that drags in Huly web UI', () => {
    expect([...loaded.keys()].filter((name) => name in TOO_HEAVY)).toEqual([])
  })
})
