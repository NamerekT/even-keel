import { needsCheckedCli } from '../../../src/agent/providers.js'

/**
 * Why the installed CLI cannot be picked (BTN-610): `picked` — the execution in the form runs only on the checked copy;
 * `saved` — the form moved off it, but the config still holds it, so the service would refuse the switch until the form
 * is saved (BTN-638); `null` — it can be picked.
 */
export function cliLockOf(provider: string, picked: string | undefined, saved: string | undefined): 'picked' | 'saved' | null {
  if (needsCheckedCli(provider, picked)) return 'picked'
  return needsCheckedCli(provider, saved) ? 'saved' : null
}
