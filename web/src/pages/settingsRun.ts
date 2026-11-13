import type { AccountView } from '../../../src/account/model.js'
import { MODEL_SLOTS, modelSlot, slotProvider, vendorOf } from '../../../src/agent/model-slots.js'
import { PROVIDERS } from '../../../src/agent/providers.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { accountName } from '../accountName.js'
import { t } from '../i18n/index.js'
import type { Values } from './settingsDraft.js'
import type { SelectOption } from '../ui/Select.js'
import { copilotOnly, copilotNote } from '../../../src/opencode/support.js'
import { say } from '../i18n/index.js'

/** The keys of a map by provider in the draft: `models` by slot (`MODEL_SLOTS`), the rest by provider. */
const keysOfMap = (map: string): readonly string[] => (map === 'models' ? MODEL_SLOTS : PROVIDERS)

/** The draft keys of a map by provider: `models.claude`, `models.opencode/openai`, `accounts.codex`. */
export const providerKeys = (map: string, providers: readonly string[] = keysOfMap(map)): string[] => providers.map((provider) => `${map}.${provider}`)

export const providerValues = (map: string, values: Record<string, string>, providers: readonly string[] = keysOfMap(map)): Values =>
  Object.fromEntries(providers.map((provider) => [`${map}.${provider}`, values[provider] ?? '']))

/** The map back from the draft, blanks left out: the service drops what equals the default. */
export const providerMap = (map: string, values: Values, providers: readonly string[] = keysOfMap(map)): Record<string, string> =>
  Object.fromEntries(
    providers.flatMap((provider) => {
      const value = (values[`${map}.${provider}`] as string).trim()
      return value === '' ? [] : [[provider, value]]
    }),
  )

/** The auto-compaction window setting of each provider that takes one (BTN-856); Copilot's CLI takes none. */
export const WINDOW_KEYS: Readonly<Record<string, 'autoCompactWindow' | 'codexAutoCompactWindow' | 'openCodeAutoCompactWindow'>> = {
  claude: 'autoCompactWindow',
  codex: 'codexAutoCompactWindow',
  opencode: 'openCodeAutoCompactWindow',
}

export const providerName = (provider: string): string => (t.settings.agents as Record<string, string>)[provider] ?? provider

export const providerOptions =(providers: readonly string[] = PROVIDERS): { value: string; label: string }[] =>
  providers.map((provider) => ({ value: provider, label: providerName(provider) }))

/**
 * The providers the form already names (`offeredProviders`): the given values and the providers with a cell of the maps
 * filled — only maps without a default, or every provider would count.
 */
export const namedProviders = (text: (key: string) => string, values: string[], maps: string[]): string[] => [
  ...values,
  ...PROVIDERS.filter((provider) => maps.some((map) => keysOfMap(map).some((key) => slotProvider(key) === provider && text(`${map}.${key}`).trim() !== ''))),
]

/** The OpenCode provider the account folder `key` is signed in to, by its last read status; `null` — not OpenCode or not read yet. */
export function accountVendor(view: AccountView | null | undefined, key: string): string | null {
  const entry = view?.accounts.find((account) => account.key === key)
  if (entry?.agent !== OPENCODE || entry.status === null) return null
  return vendorOf(entry.status.subscriptionType?.split(',').map((name) => name.trim()) ?? [])
}

/**
 * The draft key of the model a provider's row shows: the slot of the account it runs on (BTN-984), so switching
 * OpenCode's account to another sign-in shows that one's model and switching back the first again.
 */
export const modelKey = (view: AccountView | null | undefined, provider: string, account: string): string =>
  `models.${modelSlot(provider, accountVendor(view, account))}`

/** The OpenCode provider the account folder `key` signs in to, as the page names it; `null` — none picked, not OpenCode or not read yet. */
export function accountVendorName(view: AccountView | null | undefined, key: string): string | null {
  const vendor = accountVendor(view, key)
  return vendor === null ? null : (VENDOR_NAMES[vendor] ?? vendor)
}

/** OpenCode's providers by their product names: not translated. */
const VENDOR_NAMES: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  'github-copilot': 'GitHub Copilot',
  'opencode-go': 'OpenCode Go',
  opencode: 'OpenCode Zen',
}

/** The account folders of the provider, by the name the page shows them by; a key no longer listed stays choosable. */
export function accountOptions(view: AccountView, provider: string, current: string): SelectOption[] {
  const own = view.accounts
    .filter((account) => account.agent === provider)
    .map((account) => ({ value: account.key, label: accountName(account, view.accounts), ...(copilotOnly(account) && { unavailable: say(copilotNote()) }) }))
  return current === '' || own.some((option) => option.value === current) ? own : [...own, { value: current, label: current }]
}
