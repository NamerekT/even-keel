import type { CliCopyView } from '../../../src/agent/cli-state.js'
import { needsCheckedCli } from '../../../src/agent/providers.js'

export type CliSource = CliCopyView['source']

/**
 * Why the installed CLI cannot be picked (BTN-610): `picked` — the execution in the form runs only on the checked copy;
 * `null` — it can be picked. The saved config does not lock it: on /settings the version is saved with Execution (BTN-682).
 */
export function cliLockOf(provider: string, picked: string | undefined): 'picked' | null {
  return needsCheckedCli(provider, picked) ? 'picked' : null
}
