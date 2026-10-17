import type { AccountView } from '../../../src/account/model.js'
import { PROVIDERS } from '../../../src/agent/providers.js'
import { t } from '../i18n/index.js'
import type { Values } from './settingsDraft.js'

/** The draft keys of a map by provider: `models.claude`, `models.codex`. */
export const providerKeys = (map: string, providers: readonly string[] = PROVIDERS): string[] => providers.map((provider) => `${map}.${provider}`)

export const providerValues = (map: string, values: Record<string, string>, providers: readonly string[] = PROVIDERS): Values =>
  Object.fromEntries(providers.map((provider) => [`${map}.${provider}`, values[provider] ?? '']))

/** The map back from the draft, blanks left out: the service drops what equals the default. */
export const providerMap = (map: string, values: Values, providers: readonly string[] = PROVIDERS): Record<string, string> =>
  Object.fromEntries(
    providers.flatMap((provider) => {
      const value = (values[`${map}.${provider}`] as string).trim()
      return value === '' ? [] : [[provider, value]]
    }),
  )

export const providerName = (provider: string): string => (t.settings.agents as Record<string, string>)[provider] ?? provider

export const providerOptions = (): { value: string; label: string }[] => PROVIDERS.map((provider) => ({ value: provider, label: providerName(provider) }))

/** The account folders of the provider, by the name the user gave them; a key no longer listed stays choosable. */
export function accountOptions(view: AccountView, provider: string, current: string): { value: string; label: string }[] {
  const own = view.accounts.filter((account) => account.agent === provider).map((account) => ({ value: account.key, label: account.name ?? account.key }))
  return current === '' || own.some((option) => option.value === current) ? own : [...own, { value: current, label: current }]
}
