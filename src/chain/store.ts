import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { emptyChainState, type ChainState, type LaunchEntry } from './dispatcher.js'

export function loadChainState(file: string): ChainState {
  const raw = readIfExists(file)
  if (raw === undefined) return emptyChainState()
  let state: Partial<ChainState> = {}
  try {
    state = (JSON.parse(raw) ?? {}) as Partial<ChainState>
  } catch {}
  const valid =
    (state.active === null || (typeof state.active === 'object' && typeof state.active?.project === 'string')) &&
    Array.isArray(state.queue) &&
    typeof state.orders === 'object' &&
    state.orders !== null
  if (!valid) throw new Error(`chain: ${file} is damaged; fix or delete it`)
  return { ...state, skipped: state.skipped ?? {} } as ChainState
}

export function saveChainState(file: string, state: ChainState): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2))
  renameSync(temp, file)
}

export function appendLaunch(file: string, entry: LaunchEntry): void {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(entry) + '\n')
}

export function readLaunches(file: string): LaunchEntry[] {
  const raw = readIfExists(file)
  if (raw === undefined) return []
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LaunchEntry)
}

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
