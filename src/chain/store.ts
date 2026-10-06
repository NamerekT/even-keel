import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { asNotice, type Notice } from '../notice/notice.js'
import { emptyChainState, type ChainState, type LaunchEntry, type Leftover } from './dispatcher.js'

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
  const active = state.active === null || state.active === undefined ? null : { ...state.active, error: noticeOrNull(state.active.error) }
  return { ...state, active, skipped: state.skipped ?? {}, leftovers: leftoversOf(state.leftovers), released: state.released ?? {}, unattended: state.unattended === true, trimTools: state.trimTools !== false } as ChainState
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
