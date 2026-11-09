// No `node:*` here: the page's fake data reaches this through `src/tools/settings.ts`.
type Json = Record<string, unknown>
export const SETTINGS_GUARD_MARK = '--even-keel-account-settings'

function object(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {}
}

/** Removes only Even Keel's command, even when somebody put it beside a user's command in one group. */
export function stripSettingsGuard(settings: Json): Json {
  const hooks = { ...object(settings.hooks) }
  let changed = false
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    const kept = groups.flatMap((group: unknown) => {
      const entry = object(group)
      if (!Array.isArray(entry.hooks)) return [group]
      const commands = entry.hooks.filter((hook: unknown) => {
        const command = object(hook).command
        const args = object(hook).args
        return !(typeof command === 'string' && command.includes(` ${SETTINGS_GUARD_MARK} `))
          && !(Array.isArray(args) && args.includes(SETTINGS_GUARD_MARK))
      })
      if (commands.length === entry.hooks.length) return [group]
      changed = true
      return commands.length === 0 ? [] : [{ ...entry, hooks: commands }]
    })
    if (kept.length > 0 || groups.length === 0) hooks[event] = kept
    else delete hooks[event]
  }
  if (!changed) return settings
  const { hooks: _, ...rest } = settings
  return Object.keys(hooks).length === 0 ? rest : { ...rest, hooks }
}
