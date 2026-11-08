import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { codexBinaryIn, codexTarget, fetchCodex } from '../codex/release.js'
import { vi } from 'vitest'
import { CODEX_CHECKED } from '../codex/version.js'
import { ACCOUNT, CODEX_ACCOUNT } from '../e2e/service.fixture.js'
import { checkedCopy, cliVersion, type CliKit } from './kit.fixture.js'

/** The model of the account's own provider; Codex has no metadata for it and falls back to its defaults. */
export const CODEX_MODEL = 'scripted'

const OPENAI = 'https://api.openai.com/'

/** OpenAI's API as the service's key and credit checks see it: the key works, and no model is listed to spend on. */
function withOpenAi(fetchOver: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    return url.startsWith(OPENAI) ? Promise.resolve(Response.json({ object: 'list', data: [] })) : fetchOver(input, init)
  }
}

/**
 * The selected Codex (`CODEX_CHECKED` by default), the platform's npm package, on `codex exec` turns. The account `CODEX_ACCOUNT`
 * has the provider `scripted` of its `config.toml` (`model_providers`, the Responses API) as its default, and a key in
 * `auth.json`, which `codex login status` reads as signed in; the provider sends none. The service would ask OpenAI
 * about that key and take its 401 for an expired login, so the bench answers for OpenAI (`withOpenAi`).
 */
export const codex: CliKit = {
  title: 'Codex',
  agent: 'codex',
  binary: () => {
    const target = codexTarget(process.platform, process.arch)
    if (target === null) throw new Error(`Codex has no build for ${process.platform}-${process.arch}`)
    const version = cliVersion(CODEX_CHECKED)
    return checkedCopy('codex', version, (folder) => codexBinaryIn(folder, target), (folder) => fetchCodex(version, folder))
  },
  configure(run) {
    run.config.provider = 'codex'
    run.config.accounts = { claude: ACCOUNT, codex: CODEX_ACCOUNT }
    run.config.models = { codex: CODEX_MODEL }
  },
  prepare(run, binary, baseURL) {
    process.env.EVEN_KEEL_CODEX_BIN = binary
    const dir = join(run.dir, 'codex-accounts', CODEX_ACCOUNT)
    mkdirSync(dir, { recursive: true })
    const config = [
      `model = "${CODEX_MODEL}"`,
      'model_provider = "scripted"',
      'check_for_update_on_startup = false',
      '',
      '[model_providers.scripted]',
      'name = "Scripted"',
      `base_url = "${baseURL}"`,
      'wire_api = "responses"',
      '',
    ]
    writeFileSync(join(dir, 'config.toml'), config.join('\n'))
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-local-only' }))
    // The harness unstubs the globals after each test.
    vi.stubGlobal('fetch', withOpenAi(globalThis.fetch))
  },
}
