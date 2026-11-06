import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from '../locations.js'
import { opencode } from '../opencode/adapter.js'
import { fetchOpenCode, openCodeBinaryIn } from '../opencode/release.js'

/** The OpenCode account folder of the bench: no credential, one provider — the scripted model. */
export const OPENCODE_ACCOUNT = 'probe'
/** The model the project runs on, `<provider>/<model>` of the account's config. */
export const OPENCODE_MODEL = 'scripted/scripted'

/**
 * The checked OpenCode (`opencode.checked`), the platform's npm package unpacked once into `EVEN_KEEL_E2E_CLI_DIR`
 * (`.temp/e2e-cli/` of the checkout by default) and reused by later runs.
 */
export async function openCodeBinary(): Promise<string> {
  const folder = join(process.env.EVEN_KEEL_E2E_CLI_DIR ?? join(root, '.temp', 'e2e-cli'), 'opencode', opencode.checked)
  const binary = openCodeBinaryIn(folder)
  if (existsSync(binary)) return binary
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  await fetchOpenCode(opencode.checked, folder)
  return binary
}

/**
 * The account folder `OPENCODE_ACCOUNT` under the bench's `opencode-accounts/`: its config has the one provider at
 * `baseURL`, also as the small model, so a title or a summary never leaves the machine.
 */
export function openCodeAccount(accounts: string, baseURL: string): void {
  const dir = join(accounts, OPENCODE_ACCOUNT)
  mkdirSync(join(dir, 'config', 'opencode'), { recursive: true })
  mkdirSync(join(dir, 'data', 'opencode'), { recursive: true })
  writeFileSync(join(dir, 'config', 'opencode', 'AGENTS.md'), '')
  const provider = { npm: '@ai-sdk/openai-compatible', name: 'Scripted', options: { baseURL, apiKey: 'local-only' }, models: { scripted: { name: 'scripted', limit: { context: 200_000, output: 8_000 } } } }
  writeFileSync(join(dir, 'config', 'opencode', 'opencode.json'), JSON.stringify({ provider: { scripted: provider }, model: OPENCODE_MODEL, small_model: OPENCODE_MODEL, autoupdate: false, share: 'disabled' }, null, 2))
}
