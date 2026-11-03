import { pollChatGpt } from '../limits/chatgpt.js'
import { askCopilot } from '../limits/copilot.js'
import type { UsageAnswer } from '../limits/usage.js'
import { notice } from '../notice/notice.js'
import { credentials } from './home.js'

/**
 * The limits of an OpenCode folder by the sign-in its `auth.json` holds (BTN-341): ChatGPT's windows with the `openai`
 * access token, else the Copilot allowance with the GitHub token of `github-copilot` (its `refresh`). Neither is ever
 * renewed here: that is OpenCode's. The free models and API keys have no limits to read.
 */
export function openCodeUsage(auth: string | undefined, at: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<UsageAnswer> {
  const source = limitsSource(auth)
  if (source?.kind === 'chatgpt') return pollChatGpt(source.signIn, at, timeoutMs, fetchImpl)
  if (source?.kind === 'copilot') return askCopilot(source.token, at, timeoutMs, fetchImpl)
  return Promise.resolve({ kind: 'missing', reason: notice('usage.openCodeNone', {}) })
}

/**
 * The folder has neither a ChatGPT nor a Copilot sign-in, so `openCodeUsage` has nothing to ask (BTN-738). The free
 * models still have OpenCode's own usage limit; it shows only as a session's refusal.
 */
export function openCodeLimitsHidden(auth: string | undefined): boolean {
  return limitsSource(auth) === null
}

function limitsSource(auth: string | undefined) {
  const held = credentials(auth)
  const openai = held.openai
  if (openai?.type === 'oauth' && isText(openai.access)) {
    const signIn = { token: openai.access, accountId: isText(openai.accountId) ? openai.accountId : null, expiresAt: positive(openai.expires) }
    return { kind: 'chatgpt' as const, signIn }
  }
  const copilot = held['github-copilot']
  const token = copilot?.type === 'oauth' ? [copilot.refresh, copilot.access].find(isText) : undefined
  return token === undefined ? null : { kind: 'copilot' as const, token }
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value : null
}
