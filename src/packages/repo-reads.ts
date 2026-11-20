import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PackagesFile } from './model.js'
import { readJson, seedPackages, serversIn } from './plugins.js'
import type { PackagesDeps } from './service.js'

const run = promisify(execFile)

/** The name a server package may have: a repository's `.mcp.json` server with another one is not offered. */
export const SERVER_NAME = /^[\w-]+$/

/** The first catalog, from what sessions got before `state/packages.json` (`seedPackages`). */
export function seedCatalog(deps: Pick<PackagesDeps, 'file' | 'repos' | 'globalDir' | 'claudeConfigs' | 'log'>, builtIn: string | undefined): PackagesFile {
  const settingsOf = (repo: string) => [readJson(join(repo, '.claude', 'settings.json')), readJson(join(repo, '.claude', 'settings.local.json'))].filter((each) => each !== undefined)
  const userServers = Object.assign({}, ...deps.claudeConfigs().map((file) => serversIn({ mcpServers: readJson(file)?.mcpServers })).reverse())
  const seeded = seedPackages({
    globalSettings: readJson(join(deps.globalDir, 'settings.json')),
    projects: Object.entries(deps.repos).map(([key, repo]) => ({ key, settings: settingsOf(repo) })),
    userServers,
    builtIn,
  })
  deps.log(`packages: no ${deps.file}; the catalog is seeded with ${Object.keys(seeded.packages).join(', ') || 'nothing'}`)
  return seeded
}

/** By project: the servers of its repository's committed `.mcp.json` the catalog lacks, offered to import. */
export async function repoImports(repos: Record<string, string>, file: PackagesFile): Promise<Record<string, string[]>> {
  const imports: Record<string, string[]> = {}
  for (const [project, repo] of Object.entries(repos)) {
    try {
      const { stdout } = await run('git', ['-C', repo, 'ls-files', '--', '.mcp.json'], { windowsHide: true })
      if (stdout.trim() === '') continue
    } catch {
      continue
    }
    const names = Object.keys(serversIn(readJson(join(repo, '.mcp.json')))).filter((name) => {
      const known = file.packages[name]
      return SERVER_NAME.test(name) && (known === undefined || known.removed === true)
    })
    if (names.length > 0) imports[project] = names
  }
  return imports
}
