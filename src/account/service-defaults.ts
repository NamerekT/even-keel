import { checkCredit, checkOpenAiCredit, type CreditVerdict } from './credit.js'
import { checkApiKey, checkGitHubToken, checkOpenAiKey } from './keycheck.js'
export const KEY_CHECK_MS = 60 * 60_000
export const KEY_CHECK_TIMEOUT_MS = 15_000
export const CREDIT_CHECK_MS = 5 * 60_000
/**
 * The key and credit checks by whose key it is (`keyProvider`). GitHub has no way to ask about a token's AI credits: a
 * Copilot account waits out spent credit by its monthly allowance instead (`Agent.keyUsage`, BTN-341).
 */
export const KEY_CHECKS = { anthropic: checkApiKey, openai: checkOpenAiKey, github: checkGitHubToken }
export const CREDIT_CHECKS = {
  anthropic: checkCredit,
  openai: checkOpenAiCredit,
  github: async (): Promise<CreditVerdict> => ({ state: 'unknown', reason: 'GitHub does not tell the AI credits of a token' }),
}
export const APP_POLL_MS = 5_000
export const LOGIN_TIMEOUT_MS = 10 * 60_000
