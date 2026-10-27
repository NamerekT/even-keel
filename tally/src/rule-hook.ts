import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IMPORT_ACTIONS, IMPORT_PRECISIONS, RULE_PURPOSES } from '../../src/stats/rule-imports.js'
import { parseImports } from './rule-imports.js'
import { ruleFileOf, type RuleFile } from './rules.js'
import { editedInstructionSize, INSTRUCTION_LIMIT, instructionSizeNotice, isInstructionFile } from './rule-hook-size.js'

// A Claude Code hook (PostToolUse on Edit/MultiEdit/Write, and Stop) asking a session that edited rule files to
// say why in the rule history; without the why an audit sees the change but cannot judge it. Entry: tally/bin/rule-hook.mjs.

export interface HookState {
  // Rule files of the session already reminded of, by display path.
  files: string[]
  // The files the last blocked stop was about: a stop is blocked again only for files edited since.
  blocked: string[]
  oversized?: Record<string, number>
  sizeBlocked?: string[]
}

export interface HookPlace {
  home: string
  journal: string
}

export interface HookInput {
  hook_event_name?: string
  session_id?: string
  tool_name?: string
  tool_input?: { file_path?: unknown }
  tool_response?: { originalFile?: unknown; type?: unknown }
  stop_hook_active?: boolean
}

export const EMPTY_STATE: HookState = { files: [], blocked: [] }

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])
const SESSION_ID = /^[\w-]+$/
const STALE_MS = 30 * 24 * 3600 * 1000

// Snapshot rule files except memory, plus instruction files of other agents and nested config folders.
export function hookRuleFile(path: string, home: string): Pick<RuleFile, 'display' | 'kind'> | null {
  const file = ruleFileOf(path, home)
  if (file === null && isInstructionFile(path)) return { display: path.replaceAll('\\', '/'), kind: 'claude_md' }
  return file === null || file.kind === 'memory' ? null : file
}

// A session is logged by a line whose `sessions` has a prefix of its id, as the server attaches them.
// `next` is one past the largest numeric id; `taken` are the ids of the session's lines that another line has too.
export function journalCheck(text: string, session: string): { logged: boolean; errors: string[]; next: number; taken: string[] } {
  const { rows, errors } = parseImports(text)
  const own = rows.filter((row) => row.sessions.some((prefix) => prefix !== '' && session.startsWith(prefix)))
  const taken = own.filter((row) => rows.some((other) => other !== row && other.id === row.id)).map((row) => row.id)
  const next = Math.max(0, ...rows.filter((row) => /^\d+$/.test(row.id)).map((row) => Number(row.id))) + 1
  const lines = text.split(/\r?\n/)
  const short = session.slice(0, 8)
  const broken = errors.filter((error) => lines[error.line - 1]!.includes(short)).map((error) => `line ${error.line}: ${error.message}`)
  const logged = own.length > 0
  return { logged, errors: logged ? [] : broken, next, taken: [...new Set(taken)] }
}

export function afterEdit(input: HookInput, state: HookState, journal: string | null, place: HookPlace): { state: HookState; context: string | null } {
  const path = input.tool_input?.file_path
  if (!EDIT_TOOLS.has(input.tool_name ?? '') || typeof path !== 'string') return { state, context: null }
  const file = hookRuleFile(path, place.home)
  if (file === null) return { state, context: null }
  const size = editedInstructionSize(input, path)
  let next = state
  let warning: string | null = null
  if (size !== null) {
    const oversized = { ...state.oversized }
    if (size.after > INSTRUCTION_LIMIT && size.after > size.before) {
      oversized[file.display] = size.after
      warning = instructionSizeNotice({ [file.display]: size.after })
    } else if (size.after <= INSTRUCTION_LIMIT || size.after < size.before) {
      delete oversized[file.display]
    }
    next = { ...state, oversized }
  }
  if (state.files.includes(file.display)) return { state: next, context: warning }
  const session = input.session_id ?? ''
  const context =
    `Rule file changed: ${file.display}. Before you end the turn, log why in the rule history — ` +
    `${format(session, place.journal, [file.display], journalCheck(journal ?? '', session).next)} ` +
    'If this session already has a line there, add the file to its files instead of a new line.'
  return { state: { ...next, files: [...state.files, file.display] }, context: warning === null ? context : `${context}\n${warning}` }
}

export function beforeStop(input: HookInput, state: HookState, journal: string | null, place: HookPlace): { state: HookState; reason: string | null } {
  const fresh = state.files.filter((file) => !state.blocked.includes(file))
  const oversized = Object.fromEntries(Object.entries(state.oversized ?? {}).filter(([file]) => !state.sizeBlocked?.includes(file)))
  const hasSizeWarning = Object.keys(oversized).length > 0
  if (input.stop_hook_active === true || (fresh.length === 0 && !hasSizeWarning)) return { state, reason: null }
  const session = input.session_id ?? ''
  const { logged, errors, next, taken } = journalCheck(journal ?? '', session)
  const needsJournal = fresh.length > 0 && (!logged || taken.length > 0)
  if (!needsJournal && !hasSizeWarning) return { state, reason: null }
  const broken = errors.length === 0 ? '' : ` Lines of this session there do not parse: ${errors.join('; ')}.`
  const ask = logged
    ? `This session changed rule files (${state.files.join(', ')}), and its line in the rule history has id ${taken.join(', ')}, which another line has too. ` +
      `Give it id ${next}, the next free one${taken.length > 1 ? ', and the ones after it to the others' : ''}, and keep it after the last line of ${place.journal}. `
    : `This session changed rule files (${state.files.join(', ')}), and the rule history has no line with its id in sessions.${broken} ` +
      `Add it now — ${format(session, place.journal, state.files, next)} `
  const reason = (needsJournal ? ask : '') + (hasSizeWarning ? `${instructionSizeNotice(oversized)} ` : '') +
    'Then end the turn as before: if your last message ended with a CHECKPOINT: line, end with it again. This reminder comes once.'
  return { state: { ...state, blocked: [...state.files], ...(hasSizeWarning ? { sizeBlocked: [...new Set([...(state.sizeBlocked ?? []), ...Object.keys(oversized)])] } : {}) }, reason }
}

function format(session: string, journal: string, files: string[], next: number): string {
  const example = {
    id: next,
    at: '<ISO time of the edit>',
    atPrecision: 'exact',
    sessions: [session],
    files: files.map((path) => ({ path, action: 'changed', summary: '<what changed>' })),
    purpose: ['<purpose>'],
    reason: '<why: what it should fix or improve>',
    task: '<task id or empty>',
    source: 'session',
  }
  return (
    `append one JSON line per set of edits to ${journal}, after the last line (Read it, then Edit with the last line as old_string; Write only if it does not exist), ` +
    `with id ${next}, the next free one: ${JSON.stringify(example)}. ` +
    `action: ${IMPORT_ACTIONS.join(' | ')}; atPrecision: ${IMPORT_PRECISIONS.join(' | ')}; purpose: one or more of ${RULE_PURPOSES.join(', ')}; ` +
    'summary and reason in the language of the lines already there. The format is `ruleHistory` in docs/tally.md of Even Keel.'
  )
}

export interface HookEnv {
  root: string
  env: NodeJS.ProcessEnv
  home: string
}

// The hook's whole run: the output to print as JSON, or null for none.
export function runHook(raw: unknown, { root, env, home }: HookEnv): object | null {
  const input = (raw ?? {}) as HookInput
  const session = input.session_id ?? ''
  if (!SESSION_ID.test(session)) return null
  const stateDir = env.EVEN_KEEL_STATE_DIR ?? join(root, 'state')
  const place: HookPlace = { home, journal: journalPath(root, stateDir, env).replaceAll('\\', '/') }
  const stateFile = join(stateDir, 'rule-hook', `${session}.json`)
  const state = readState(stateFile)

  if (input.hook_event_name === 'PostToolUse') {
    const previous = state ?? EMPTY_STATE
    const next = afterEdit(input, previous, readText(place.journal), place)
    if (next.state !== previous) writeState(stateFile, next.state, state === null)
    if (next.context === null) return null
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: next.context } }
  }
  if (input.hook_event_name === 'Stop' && state !== null) {
    const next = beforeStop(input, state, readText(place.journal), place)
    if (next.reason === null) return null
    writeState(stateFile, next.state, false)
    return { decision: 'block', reason: next.reason }
  }
  return null
}

// As the collector resolves it: `ruleHistory` of tally.config.json against the root, otherwise the state folder.
function journalPath(root: string, stateDir: string, env: NodeJS.ProcessEnv): string {
  let configured: unknown
  try {
    configured = JSON.parse(readFileSync(env.TALLY_CONFIG ?? join(root, 'tally', 'tally.config.json'), 'utf8')).ruleHistory
  } catch {
    configured = undefined
  }
  return resolve(root, typeof configured === 'string' && configured !== '' ? configured : join(stateDir, 'rule-history.jsonl'))
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function readState(path: string): HookState | null {
  const text = readText(path)
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as Partial<HookState>
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [])
    const oversized = Object.fromEntries(Object.entries(raw.oversized ?? {}).filter(([, bytes]) => typeof bytes === 'number' && Number.isFinite(bytes) && bytes > INSTRUCTION_LIMIT))
    return { files: list(raw.files), blocked: list(raw.blocked), ...(raw.oversized === undefined ? {} : { oversized }), ...(raw.sizeBlocked === undefined ? {} : { sizeBlocked: list(raw.sizeBlocked) }) }
  } catch {
    return null
  }
}

// A new session's file also sweeps out those of sessions untouched for a month.
function writeState(path: string, state: HookState, fresh: boolean): void {
  const dir = join(path, '..')
  mkdirSync(dir, { recursive: true })
  if (fresh) {
    const now = Date.now()
    for (const name of readdirSync(dir)) {
      const other = join(dir, name)
      try {
        if (now - statSync(other).mtimeMs > STALE_MS) rmSync(other, { force: true })
      } catch {
        // Another session's hook may have removed it first.
      }
    }
  }
  writeFileSync(path, `${JSON.stringify(state)}\n`)
}
