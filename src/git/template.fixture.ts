import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Repositories a test builds the same way again and again, built once per run and copied whole (BTN-1483): on Windows
 * each git process is costly, and Defender checks every one. A test that checks git itself keeps git.
 */

const ORIGIN = 'origin.txt'
const REPOSITORY = 'repository'

interface Template {
  /** The folder the build ran in: the copies' git configs name it. */
  origin: string
  path: string
}

const templates = new Map<string, Promise<Template>>()

/** Inside the run's temp root (`test/temp-root.ts`): the workers of one run share them, and the run removes them. */
const templatesFolder = () => join(tmpdir(), 'git-templates')

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `text` with the folder `from` turned into `to`, written plain, with git's doubled backslashes or with forward slashes. */
export function retarget(text: string, from: string, to: string): string {
  const forms = (path: string) => [path.replaceAll('\\', '\\\\'), path.replaceAll('\\', '/'), path]
  const into = new Map(forms(from).map((form, index) => [form, forms(to)[index]!]))
  const pattern = new RegExp(`(${[...into.keys()].map(escape).join('|')})(?=[\\\\/\\s"]|$)`, 'gm')
  return text.replace(pattern, (form) => into.get(form)!)
}

/** Git's own files that name a folder: a repository's `config`, a worktree's `.git` and `gitdir`. */
function pathFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name === '.git' || entry.name === 'gitdir' || (entry.name === 'config' && existsSync(join(entry.parentPath, 'HEAD')))))
    .map((entry) => join(entry.parentPath, entry.name))
}

async function made(name: string, build: (path: string) => unknown): Promise<Template> {
  const folder = join(templatesFolder(), name)
  const read = (): Template => ({ origin: readFileSync(join(folder, ORIGIN), 'utf8'), path: join(folder, REPOSITORY) })
  if (existsSync(folder)) return read()
  mkdirSync(templatesFolder(), { recursive: true })
  const building = mkdtempSync(join(templatesFolder(), `${name}.build-`))
  try {
    const origin = join(building, REPOSITORY)
    mkdirSync(origin)
    await build(origin)
    writeFileSync(join(building, ORIGIN), origin)
    // Another worker of the run may have built it meanwhile: a folder renamed whole is never seen half made.
    try {
      renameSync(building, folder)
    } catch (error) {
      if (!existsSync(folder)) throw error
    }
    return read()
  } finally {
    rmSync(building, { recursive: true, force: true })
  }
}

/** Runs git in `cwd` once per item of `steps`, for a build: the first that fails throws. */
export function gitSteps(cwd: string, steps: readonly (readonly string[])[]): void {
  for (const args of steps) execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })
}

/**
 * Copies the run's template `name` into `destination` (an empty or missing folder), building it first with `build` in a
 * folder of its own. The same `name` must always mean the same `build`. Paths the build wrote into git's configs are
 * turned into the copy's own.
 */
export async function copyRepository(name: string, destination: string, build: (path: string) => unknown): Promise<void> {
  let template = templates.get(name)
  if (template === undefined) {
    template = made(name, build)
    templates.set(name, template)
    template.catch(() => templates.delete(name))
  }
  const { origin, path } = await template
  cpSync(path, destination, { recursive: true })
  for (const file of pathFiles(destination)) writeFileSync(file, retarget(readFileSync(file, 'utf8'), origin, destination))
}
