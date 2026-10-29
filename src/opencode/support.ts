import type { AccountStatus } from '../account/model.js'
import { notice } from '../notice/notice.js'

export const copilotUnsupported = () => notice('chain.opencodeCopilot', {})
export const copilotNote = () => notice('account.opencodeCopilot', {})

export const copilotModel = (model: string | null): boolean => model?.startsWith('github-copilot/') === true

/** Credentials stay visible and their allowance is still read; only execution is unavailable. */
export function hasCopilot(entry: { agent: string; status: AccountStatus | null }): boolean {
  return entry.agent === 'opencode' && providers(entry.status).includes('github-copilot')
}

export function copilotOnly(entry: { agent: string; status: AccountStatus | null }): boolean {
  return hasCopilot(entry) && providers(entry.status).every(provider => provider === 'github-copilot')
}

function providers(status: AccountStatus | null): string[] {
  return status?.subscriptionType?.split(',').map(value => value.trim()).filter(Boolean) ?? []
}
