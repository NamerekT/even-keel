import { CLAUDE } from '../claude/name.js'
import { fail, notice, type Notice } from '../notice/notice.js'
import type { AgentStatus, SessionRecord } from '../sessions/agents.js'
import type { AccountView } from './model.js'

export type AppId = 'vscode'

export const APP_LABELS: Record<AppId, string> = { vscode: 'VS Code' }

export interface AppSession {
  name: string
  status: AgentStatus | null
}

export interface AppAccount {
  app: AppId
  account: string | null
  dir: string | null
  error: Notice | null
  sessions: AppSession[]
}

const SETTING = 'claudeCode.environmentVariables'
const VARIABLE = 'CLAUDE_CONFIG_DIR'
const VSCODE_ENTRYPOINT = 'claude-vscode'

interface Variable {
  name: string
  value: string
}

export function configDirOf(settings: string): string | null {
  const variables = parseSettings(settings)[SETTING]
  if (!Array.isArray(variables)) return null
  const found = variables.find((each): each is Variable => isVariable(each) && each.name === VARIABLE)
  return found === undefined || found.value === '' ? null : found.value
}

export function withConfigDir(settings: string, dir: string | null): string {
  const parsed = parseSettings(settings)
  const current: unknown[] = Array.isArray(parsed[SETTING]) ? parsed[SETTING] : []
  const index = current.findIndex((each) => isVariable(each) && each.name === VARIABLE)
  const next = [...current]
  if (dir === null) {
    if (index >= 0) next.splice(index, 1)
  } else if (index >= 0) {
    next[index] = { name: VARIABLE, value: dir }
  } else {
    next.push({ name: VARIABLE, value: dir })
  }
  const result: Record<string, unknown> = { ...parsed, [SETTING]: next }
  if (next.length === 0) delete result[SETTING]
  const eol = settings.includes('\r\n') ? '\r\n' : '\n'
  const text = JSON.stringify(result, null, indentOf(settings)).replace(/\n/g, eol)
  return settings.trim() === '' || /\r?\n$/.test(settings) ? `${text}${eol}` : text
}

export function vscodeChats(records: SessionRecord[]): AppSession[] {
  return records
    .filter((record) => record.entrypoint === VSCODE_ENTRYPOINT)
    .map((record) => ({ name: record.name ?? lastSegment(record.cwd) ?? record.sessionId.slice(0, 8), status: record.status ?? null }))
}

export function appSwitchProblem(view: AccountView, app: string, key: string): Notice | undefined {
  const current = view.apps.find((each) => each.app === app)
  if (current === undefined) return notice('app.unknown', { app })
  const label = APP_LABELS[current.app]
  if (current.error !== null) return current.error
  const target = view.accounts.find((entry) => entry.key === key)
  if (target === undefined) return notice('account.unknown', { key })
  if (target.agent !== CLAUDE) return notice('account.codexFolder', {})
  const email = target.status?.email ?? key
  if (current.account === key) return notice('app.alreadyUses', { app: label, account: email })
  if (target.removing) return notice('account.removing', { account: email })
  if (target.needsLogin || target.status?.loggedIn !== true) return notice('account.needsLogin', { account: email })
  if (current.sessions.length > 0) return notice('app.chatsOpen', { app: label, chats: current.sessions.map((session) => session.name) })
  return undefined
}

function parseSettings(settings: string): Record<string, unknown> {
  if (settings.trim() === '') return {}
  let value: unknown
  try {
    value = JSON.parse(settings)
  } catch {
    throw fail('vscode.notJson', {})
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fail('vscode.notObject', {})
  return value as Record<string, unknown>
}

function isVariable(value: unknown): value is Variable {
  if (typeof value !== 'object' || value === null) return false
  const { name, value: text } = value as Record<string, unknown>
  return typeof name === 'string' && typeof text === 'string'
}

function indentOf(settings: string): string | number {
  const indent = /\n([ \t]+)\S/.exec(settings)?.[1]
  if (indent === undefined) return 4
  return indent.startsWith('\t') ? '\t' : indent.length
}

function lastSegment(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).at(-1)
}
