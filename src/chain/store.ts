import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { asNotice, type Notice } from '../notice/notice.js'
import { emptyChainState, type ActiveChain, type ChainState, type CurrentTask, type LaunchEntry, type Leftover } from './dispatcher.js'

export function loadChainState(file: string): ChainState {
  const raw = readIfExists(file)
  if (raw === undefined) return emptyChainState()
  let state: Omit<Partial<ChainState>, 'active'> & { active?: unknown } = {}
  try {
    state = (JSON.parse(raw) ?? {}) as Partial<ChainState>
  } catch {}
  const chains = activeOf(state.active)
  const valid = chains !== undefined && Array.isArray(state.queue) && typeof state.orders === 'object' && state.orders !== null
  if (!valid) throw new Error(`chain: ${file} is damaged; fix or delete it`)
  const active = chains.map((chain) => ({ ...chain, current: settled(chain.current), error: noticeOrNull(chain.error) }))
  return { ...state, active, skipped: state.skipped ?? {}, leftovers: leftoversOf(state.leftovers), released: state.released ?? {}, unattended: state.unattended === true, trimTools: state.trimTools !== false } as ChainState
}

// Before BTN-67 one chain ran at a time and `active` was that chain or null.
function activeOf(raw: unknown): ActiveChain[] | undefined {
  const chains = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
  const valid = chains.every((chain) => typeof chain === 'object' && chain !== null && typeof (chain as ActiveChain).project === 'string')
  return valid ? (chains as ActiveChain[]) : undefined
}

// A start cut short by a service restart is not running any more.
function settled(current: CurrentTask | null | undefined): CurrentTask | null {
  if (current == null) return null
  const { starting: _, ...rest } = current
  return rest
}

// Before BTN-62 the pause reason and the leftovers were English strings; they are kept and shown as they are.
function noticeOrNull(value: unknown): Notice | null {
  return value === null || value === undefined ? null : asNotice(value)
}

function leftoversOf(stored: Record<string, unknown[]> | undefined): Record<string, Leftover[]> {
  const result: Record<string, Leftover[]> = {}
  for (const [project, list] of Object.entries(stored ?? {})) {
    result[project] = list.map((entry) => {
      const { task, at, notice, text } = entry as Partial<Leftover> & { text?: unknown }
      return { task: String(task), at: String(at), notice: asNotice(notice ?? text) }
    })
  }
  return result
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
