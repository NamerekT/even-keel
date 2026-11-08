import { checkCredit, checkOpenAiCredit, checkOpenRouterCredit, type CreditVerdict } from './credit.js'
import { checkApiKey, checkGitHubToken, checkOpenAiKey, checkOpenRouterKey } from './keycheck.js'
export const KEY_CHECK_MS = 60 * 60_000
export const KEY_CHECK_TIMEOUT_MS = 15_000
export const CREDIT_CHECK_MS = 5 * 60_000
/** The OpenRouter key's `usage` is read before a turn too: a short wait, a missed read only moves the growth on (BTN-860). */
export const KEY_SPEND_TIMEOUT_MS = 5_000
/** How long after the last turn a growth of `usage` still goes to its session, and how often the key is read meanwhile. */
export const KEY_SPEND_TAIL_MS = 10 * 60_000
export const KEY_SPEND_POLL_MS = 60_000
/**
 * The key and credit checks by whose key it is (`keyProvider`). GitHub has no way to ask about a token's AI credits: a
 * Copilot account waits out spent credit by its monthly allowance instead (`Agent.keyUsage`, BTN-341).
 */
export const KEY_CHECKS = { anthropic: checkApiKey, openai: checkOpenAiKey, openrouter: checkOpenRouterKey, github: checkGitHubToken }
export const CREDIT_CHECKS = {
  anthropic: checkCredit,
  openai: checkOpenAiCredit,
  openrouter: checkOpenRouterCredit,
  github: async (): Promise<CreditVerdict> => ({ state: 'unknown', reason: 'GitHub does not tell the AI credits of a token' }),
}
/** The check turn of a new cloud account: the CLI gives up resolving AWS credentials after 60 s itself. */
export const CLOUD_CHECK_TIMEOUT_MS = 120_000
export const CLOUD_CHECK_PROMPT = 'This is a connection check. Reply with the single word OK and use no tools.'
export const APP_POLL_MS = 5_000
export const LOGIN_TIMEOUT_MS = 10 * 60_000
