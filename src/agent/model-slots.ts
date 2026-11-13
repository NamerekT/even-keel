import { OPENCODE } from '../opencode/name.js'
import { PROVIDERS } from './providers.js'

/**
 * The providers of OpenCode a folder may be signed in to (BTN-984), as the keys of its `auth.json` and the prefixes of
 * its models: `openai` — a ChatGPT sign-in or an OpenAI key, `opencode` — no sign-in or a Zen key. The order picks one
 * for a folder signed in to several. A page-safe list.
 */
export const OPENCODE_VENDORS: readonly string[] = ['openai', 'anthropic', 'openrouter', 'github-copilot', 'opencode-go', 'opencode']
/** OpenCode's own models: a folder with no sign-in, or with none of `OPENCODE_VENDORS`. */
export const FREE_VENDOR = 'opencode'

/**
 * The keys of `models`: a provider, and for OpenCode a slot of each of its providers (`opencode/openai`), so a model
 * picked for one sign-in stays when the account is switched to another and back.
 */
export const MODEL_SLOTS: readonly string[] = PROVIDERS.flatMap((provider) =>
  provider === OPENCODE ? OPENCODE_VENDORS.map((vendor) => `${OPENCODE}/${vendor}`) : [provider],
)

export const isModelSlot = (key: string): boolean => MODEL_SLOTS.includes(key)

/** The provider of OpenCode a folder signed in to these (its `auth.json` keys, `subscriptionType`) runs models of. */
export function vendorOf(names: readonly string[]): string {
  return OPENCODE_VENDORS.find((vendor) => names.includes(vendor)) ?? FREE_VENDOR
}

/** The key of `models` for a session of the provider on a folder of this OpenCode provider; `null` — not known. */
export function modelSlot(provider: string, vendor: string | null): string {
  return provider === OPENCODE ? `${OPENCODE}/${vendor ?? FREE_VENDOR}` : provider
}

/** The provider a key of `models` is of. */
export const slotProvider = (slot: string): string => slot.split('/')[0]!

export const modelOf = (models: Readonly<Record<string, string>>, provider: string, vendor: string | null): string | undefined =>
  models[modelSlot(provider, vendor)]

/** The slot an OpenCode model of a config from before the slots goes to: by its prefix, else OpenCode's own. */
export function slotOfModel(model: string): string {
  const prefix = model.trim().split('/')[0]!
  return modelSlot(OPENCODE, model.includes('/') && OPENCODE_VENDORS.includes(prefix) ? prefix : FREE_VENDOR)
}
