import type { ActiveChain } from '../chain/dispatcher.js'
import { isOpen, type HulyTask } from '../huly/model.js'
import type { Lamp } from '../sessions/agents.js'

export interface ClaudeAccount {
  loggedIn: boolean
  authMethod: string | null
  email: string | null
  orgName: string | null
  subscriptionType: string | null
}

export interface AccountLogin {
  startedAt: string
  urls: string[]
  output: string
  error: string | null
  codeSent: boolean
}

export interface AccountView {
  status: ClaudeAccount | null
  error: string | null
  login: AccountLogin | null
  loginBlock: string | null
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g
const URL_PATTERN = /https:\/\/[^\s"'<>\u001b]+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/

export function parseAuthStatus(text: string): ClaudeAccount {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`claude: auth status is not JSON: ${text.trim().slice(0, 200)}`)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('claude: auth status is not an object')
  const fields = body as Record<string, unknown>
  if (typeof fields.loggedIn !== 'boolean') throw new Error('claude: auth status has no loggedIn flag')
  return {
    loggedIn: fields.loggedIn,
    authMethod: stringOf(fields.authMethod),
    email: stringOf(fields.email),
    orgName: stringOf(fields.orgName),
    subscriptionType: stringOf(fields.subscriptionType),
  }
}

export function cleanOutput(raw: string): string {
  return raw.replace(ANSI, '').replace(/\r\n?/g, '\n')
}

export function loginUrls(output: string): string[] {
  const found = cleanOutput(output).match(URL_PATTERN) ?? []
  return [...new Set(found.map((url) => url.replace(TRAILING_PUNCTUATION, '')))]
}

export function loginBlock(
  chain: ActiveChain | null,
  sessions: { task: string; lamp: Lamp }[],
  tasks: HulyTask[],
): string | undefined {
  if (chain !== null && !chain.paused) return `claude: chain ${chain.project} is running; pause it before switching the account`
  const closed = new Set(tasks.filter((task) => !isOpen(task.status)).map((task) => task.id))
  const live = sessions.filter((view) => view.lamp !== 'finished' && !closed.has(view.task)).map((view) => view.task)
  if (live.length > 0) return `claude: sessions are still alive (${live.join(', ')}); switch the account once they finish`
  return undefined
}

export function launchBlock(view: AccountView): string | undefined {
  if (view.login !== null && view.login.error === null) return 'claude: sign-in is in progress; resume once it is done'
  if (view.status?.loggedIn === false) return 'claude: not signed in; sign in from the account menu, then resume'
  return undefined
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
