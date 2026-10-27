import { DEFAULT_PROTECTION, type Protection } from '../../../src/sessions/protection.js'

export interface ProtectionDraft { disabled: string[]; claude: string; codex: string; copilot: string; opencode: string }
export const protectionText = (value: Protection = DEFAULT_PROTECTION): string => JSON.stringify({
  disabled: value.disabled, claude: value.claude.join('\n'), codex: value.codex.map(prefix => JSON.stringify(prefix)).join('\n'), copilot: value.copilot.join('\n'), opencode: value.opencode.join('\n'),
} satisfies ProtectionDraft)
export const protectionDraft = (text: string): ProtectionDraft => JSON.parse(text) as ProtectionDraft
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean)
export function protectionOf(text: string): Protection | undefined {
  try {
    const draft = protectionDraft(text)
    const codex = lines(draft.codex).map(line => JSON.parse(line) as string[])
    if (codex.some(prefix => !Array.isArray(prefix) || prefix.length === 0 || prefix.some(arg => typeof arg !== 'string' || arg.length === 0))) return undefined
    return { disabled: draft.disabled, claude: lines(draft.claude), codex, copilot: lines(draft.copilot), opencode: lines(draft.opencode) }
  } catch { return undefined }
}
