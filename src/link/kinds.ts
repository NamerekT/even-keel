import type { MachineKind } from '../state.js'

/** What a machine's icon shows of it (BTN-1595): the platform of the system it reported and whether it runs in Docker. */
export function kindOf(about: { os: string; container?: boolean } | null): MachineKind {
  const platform = about?.os.split(' ')[0] ?? ''
  return {
    ...(platform !== '' && { platform }),
    ...(about?.container === true && { container: true as const }),
  }
}
