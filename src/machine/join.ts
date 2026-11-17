import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isRefusal, parseToken, type ConnectionToken, type MachineAbout, type Refusal } from '../link/protocol.js'

/** What `even-keel status` reads (BTN-1242): written by `join`, and by the machine's service once it runs (BTN-1247). */
export const LINK_FILE = 'machine-link.json'

export interface LinkFile {
  hub: string
  machine: string
  root: string
  joinedAt: number
  /** When the hub was last heard; absent — not since the join. */
  contactAt?: number
}

/** The variable a test installation (a sandbox, a bench) is started with: it never joins a hub. */
export const TEST_INSTANCE_VAR = 'EVEN_KEEL_TEST_INSTANCE'

export interface JoinDeps {
  stateDir: string
  env: NodeJS.ProcessEnv
  /** The folder of projects when `--root` names none. */
  defaultRoot: string
  /** Whether the service of this installation runs: it owns the machine's database. */
  serviceRuns(): Promise<boolean>
  /** How many projects this installation has. */
  projects(): Promise<number>
  about(root: string): Promise<MachineAbout>
  exchange(token: ConnectionToken, about: MachineAbout): Promise<ConnectionToken | Refusal>
  /** Keeps the token with the machine's own secret and the folder of projects in the machine's database. */
  keep(token: ConnectionToken, root: string): Promise<void>
  now(): number
}

/** A join that did not happen: the line to print, nothing kept. */
export class JoinRefused extends Error {}

const REFUSALS: Record<Refusal['refused'], string> = {
  token: 'the hub does not know this connection string, or it was revoked; issue a new one on the hub',
  version: 'the hub runs another version of Even Keel; update both to the same version',
  connection: 'the hub refused the connection; try again',
  expired: 'the connection string has expired; issue a new one on the hub',
  used: 'a machine has joined with this connection string already; issue a new one on the hub',
}

/**
 * `even-keel join <string> [--root <folder>]`: this installation becomes a machine of the hub the string names. Only
 * an installation with no projects of its own, with its service stopped, and never a test one.
 */
export async function joinAsMachine(line: string, rootArgument: string | undefined, deps: JoinDeps): Promise<LinkFile> {
  if (deps.env[TEST_INSTANCE_VAR] === '1') throw new JoinRefused(`a test installation (${TEST_INSTANCE_VAR}=1) does not join a hub`)
  const token = parseToken(line)
  if (token === undefined) throw new JoinRefused('this is not a connection string: copy the whole line the hub issued, it starts with ekm1.')
  if (await deps.serviceRuns()) throw new JoinRefused('the service of this installation runs: stop it first, then join, then start it again')
  const projects = await deps.projects()
  if (projects > 0) {
    throw new JoinRefused(`this installation has ${projects} project(s) of its own: a machine has none, the hub gives it its projects. Remove them, or join from another installation`)
  }
  const root = resolve(rootArgument ?? deps.defaultRoot)
  if (!isAbsolute(root)) throw new JoinRefused(`the folder of projects must be an absolute path: ${root}`)
  mkdirSync(root, { recursive: true })
  let answer: ConnectionToken | Refusal
  try {
    answer = await deps.exchange(token, await deps.about(root))
  } catch (error) {
    throw new JoinRefused(`the hub at ${token.hub} was not reached: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (isRefusal(answer)) throw new JoinRefused(REFUSALS[answer.refused])
  await deps.keep(answer, root)
  const file: LinkFile = { hub: token.hub, machine: token.machine, root, joinedAt: deps.now() }
  writeLinkFile(deps.stateDir, file)
  return file
}

export function writeLinkFile(stateDir: string, file: LinkFile): void {
  const path = join(stateDir, LINK_FILE)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.draft`, JSON.stringify(file, null, 2))
  renameSync(`${path}.draft`, path)
}

export function readLinkFile(stateDir: string): LinkFile | undefined {
  const path = join(stateDir, LINK_FILE)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LinkFile>
    if (typeof value.hub !== 'string' || typeof value.machine !== 'string' || typeof value.root !== 'string' || typeof value.joinedAt !== 'number') return undefined
    return value as LinkFile
  } catch {
    return undefined
  }
}

/**
 * The link of a join with this very string, the same hub and the same machine; `undefined` — not joined with it. The
 * string is good for one join, so an installer run again (BTN-1243) goes on with the link it has.
 */
export function joinedWith(stateDir: string, line: string): LinkFile | undefined {
  const token = parseToken(line)
  const file = readLinkFile(stateDir)
  return token !== undefined && file?.hub === token.hub && file.machine === token.machine ? file : undefined
}

/** What `even-keel status` prints. */
export function statusLines(file: LinkFile | undefined, now: number): string[] {
  if (file === undefined) return ['not a machine: this installation has joined no hub (even-keel join <connection string>)']
  const ago = (at: number) => {
    const minutes = Math.round((now - at) / 60_000)
    return minutes < 1 ? 'just now' : minutes < 120 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`
  }
  return [
    `a machine of the hub ${file.hub}`,
    `  machine id: ${file.machine}`,
    `  folder of projects: ${file.root}`,
    `  joined: ${new Date(file.joinedAt).toISOString()}`,
    `  last contact with the hub: ${file.contactAt === undefined ? 'none since the join' : `${new Date(file.contactAt).toISOString()} (${ago(file.contactAt)})`}`,
  ]
}
