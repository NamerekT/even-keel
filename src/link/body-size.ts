const DEPTH = 4
const SHOWN = 5

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '')

const sizeText = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** An object's own parts; an array of events — its events by type; anything else has none to name. */
function partsIn(value: unknown): Array<[string, unknown]> {
  if (isObject(value)) return Object.entries(value)
  if (!Array.isArray(value) || !value.every((each) => isObject(each) && typeof each.type === 'string')) return []
  const byType = new Map<string, unknown[]>()
  for (const each of value as Array<{ type: string }>) byType.set(each.type, [...(byType.get(each.type) ?? []), each])
  return [...byType].map(([type, events]) => [`${type} ×${events.length}`, events])
}

/**
 * The largest parts of a post's body with their sizes, level by level down its largest part: what a line in the log
 * says of a post over the hub's limit (BTN-1559), e.g. `body: snapshot 9.1 MB, …; snapshot (3 parts): facts 9.0 MB, …`.
 */
export function partsOf(body: unknown): string {
  const levels: string[] = []
  let name = 'body'
  let value = body
  for (let depth = 0; depth < DEPTH; depth += 1) {
    const parts = partsIn(value).map(([key, part]) => ({ key, part, bytes: bytesOf(part) })).sort((one, other) => other.bytes - one.bytes)
    if (parts.length === 0) break
    const shown = parts.slice(0, SHOWN).map(({ key, bytes }) => `${key} ${sizeText(bytes)}`)
    levels.push(`${name} (${parts.length} parts): ${shown.join(', ')}${parts.length > SHOWN ? ', …' : ''}`)
    if (Array.isArray(value)) break
    name = depth === 0 ? parts[0]!.key : `${name}.${parts[0]!.key}`
    value = parts[0]!.part
  }
  return levels.join('; ')
}
