/**
 * The machines' colours by default (BTN-1272): muted, neither black nor white, and away from the saturated account
 * colours (`--series-*` of the page), so a machine's mark never reads as an account's dot.
 */
export const MACHINE_PALETTE: readonly string[] = ['#6f8f7f', '#a08060', '#7a8a9a', '#8f8a70', '#9c7a8c', '#5f8a96', '#8c7f6a', '#857a9c']

const HEX = /^#[0-9a-f]{6}$/

/** A colour as the page sends it, lower case; `undefined` — not `#rrggbb`. */
export function colorOf(value: string): string | undefined {
  const color = value.trim().toLowerCase()
  return HEX.test(color) ? color : undefined
}

/** Each machine's colour: its own, else the palette's by its place among the hub's machines, oldest first. */
export function machineColors(machines: ReadonlyArray<{ id: string; color?: string | null }>): Record<string, string> {
  return Object.fromEntries(machines.map((machine, index) => [machine.id, machine.color ?? MACHINE_PALETTE[index % MACHINE_PALETTE.length]!]))
}
