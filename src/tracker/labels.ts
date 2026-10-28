export interface LabelChange {
  add: string[]
  remove: string[]
}

export const labelKey = (name: string): string => name.trim().toLocaleLowerCase()

/** Removals precede additions; the first spelling wins, as in `toTask`. */
export function changedLabels(current: string[], change: LabelChange): string[] {
  const removed = new Set(change.remove.map(labelKey))
  const labels = new Map<string, string>()
  for (const name of [...current.filter((name) => !removed.has(labelKey(name))), ...change.add]) {
    const key = labelKey(name)
    if (key !== '' && !labels.has(key)) labels.set(key, name.trim())
  }
  return [...labels.values()]
}

export interface NamedLabel { id: string; name: string }

export async function resolveLabels<T extends { name: string }>(
  current: T[], change: LabelChange, catalog: T[], create: (name: string) => Promise<T>,
): Promise<T[]> {
  const known = new Map<string, T>()
  for (const label of [...current, ...catalog]) if (!known.has(labelKey(label.name))) known.set(labelKey(label.name), label)
  const result: T[] = []
  for (const name of changedLabels(current.map((label) => label.name), change)) {
    const label = known.get(labelKey(name)) ?? await create(name)
    known.set(labelKey(name), label)
    result.push(label)
  }
  return result
}
