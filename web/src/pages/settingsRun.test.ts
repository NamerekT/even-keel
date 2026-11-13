import { describe, expect, it } from 'vitest'
import type { AccountView } from '../../../src/account/model.js'
import { accountVendorName, modelKey } from './settingsRun.js'

const entry = (key: string, agent: string, subscriptionType: string | null) => ({ key, agent, status: { subscriptionType } })
const view = {
  accounts: [entry('chatgpt', 'opencode', 'openai'), entry('mixed', 'opencode', 'openrouter, anthropic'), entry('zen', 'opencode', null), entry('codex', 'codex', 'plus')],
} as unknown as AccountView

describe("the model field of a provider's row (BTN-984)", () => {
  it("edits the slot of the OpenCode account's sign-in", () => {
    expect(modelKey(view, 'opencode', 'chatgpt')).toBe('models.opencode/openai')
    expect(modelKey(view, 'opencode', 'mixed')).toBe('models.opencode/anthropic')
    expect(modelKey(view, 'opencode', 'zen')).toBe('models.opencode/opencode')
    expect(modelKey(view, 'codex', 'codex')).toBe('models.codex')
  })

  it("takes OpenCode's own slot while the account is not picked or not read", () => {
    expect(modelKey(view, 'opencode', '')).toBe('models.opencode/opencode')
    expect(modelKey(null, 'opencode', 'chatgpt')).toBe('models.opencode/opencode')
  })

  it('names the sign-in only of a picked OpenCode account', () => {
    expect(accountVendorName(view, 'chatgpt')).toBe('OpenAI')
    expect(accountVendorName(view, 'zen')).toBe('OpenCode Zen')
    expect(accountVendorName(view, '')).toBeNull()
    expect(accountVendorName(view, 'codex')).toBeNull()
  })
})
