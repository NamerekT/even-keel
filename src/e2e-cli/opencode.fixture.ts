import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCOUNT } from '../e2e/service.fixture.js'
import { opencode } from '../opencode/adapter.js'
import { fetchOpenCode, openCodeBinaryIn } from '../opencode/release.js'
import { checkedCopy, cliVersion, type CliKit } from './kit.fixture.js'

/** The OpenCode account folder of the bench: no credential, one provider — the scripted model. */
export const OPENCODE_ACCOUNT = 'probe'
/** The model the project runs on, `<provider>/<model>` of the account's config. */
export const OPENCODE_MODEL = 'scripted/scripted'

/**
 * The selected OpenCode (`opencode.checked` by default), the platform's npm package. Its account `OPENCODE_ACCOUNT` has one
 * provider, `scripted`, through `@ai-sdk/openai-compatible`, also as the small model, so a title or a summary never
 * leaves the machine; OpenCode installs that npm package into the account's cache at the first turn.
 */
export const openCode: CliKit = {
  title: 'OpenCode',
  agent: 'opencode',
  binary: () => {
    const version = cliVersion(opencode.checked)
    return checkedCopy('opencode', version, (folder) => openCodeBinaryIn(folder), (folder) => fetchOpenCode(version, folder))
  },
  configure(run) {
    run.config.provider = 'opencode'
    run.config.accounts = { claude: ACCOUNT, opencode: OPENCODE_ACCOUNT }
    // The folder has no `auth.json`: its sessions take the model of OpenCode's own slot (BTN-984).
    run.config.models = { 'opencode/opencode': OPENCODE_MODEL }
  },
  prepare(run, binary, baseURL) {
    process.env.EVEN_KEEL_OPENCODE_BIN = binary
    const dir = join(run.dir, 'opencode-accounts', OPENCODE_ACCOUNT)
    mkdirSync(join(dir, 'config', 'opencode'), { recursive: true })
    mkdirSync(join(dir, 'data', 'opencode'), { recursive: true })
    writeFileSync(join(dir, 'config', 'opencode', 'AGENTS.md'), '')
    const provider = { npm: '@ai-sdk/openai-compatible', name: 'Scripted', options: { baseURL, apiKey: 'local-only' }, models: { scripted: { name: 'scripted', limit: { context: 200_000, output: 8_000 } } } }
    writeFileSync(join(dir, 'config', 'opencode', 'opencode.json'), JSON.stringify({ provider: { scripted: provider }, model: OPENCODE_MODEL, small_model: OPENCODE_MODEL, autoupdate: false, share: 'disabled' }, null, 2))
  },
}
