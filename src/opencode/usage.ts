import { askChatGpt } from '../limits/chatgpt.js'
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
  const held = credentials(auth)
  const openai = held.openai
  if (openai?.type === 'oauth' && isText(openai.access)) {
    const signIn = { token: openai.access, accountId: isText(openai.accountId) ? openai.accountId : null, expiresAt: positive(openai.expires) }
    return askChatGpt(signIn, at, timeoutMs, fetchImpl)
  }
  const copilot = held['github-copilot']
  const token = copilot?.type === 'oauth' ? [copilot.refresh, copilot.access].find(isText) : undefined
  if (token !== undefined) return askCopilot(token, at, timeoutMs, fetchImpl)
  return Promise.resolve({ kind: 'missing', reason: notice('usage.openCodeNone', {}) })
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value : null
}
