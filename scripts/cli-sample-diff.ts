import type { CliSample } from './cli-samples.js'

function shape(samples: CliSample[]): { types: Set<string>; fields: Set<string> } {
  const types = new Set<string>()
  const fields = new Set<string>()
  const walk = (value: unknown, type: string, prefix = ''): void => {
    if (Array.isArray(value)) { value.forEach((entry) => walk(entry, type, `${prefix}[]`)); return }
    if (value === null || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`
      fields.add(`${type}:${path}`)
      walk(entry, type, path)
    }
  }
  const add = (event: Record<string, unknown>, kind?: string) => {
    const payload = event.payload as Record<string, unknown> | undefined
    const type = kind ?? String(event.type ?? 'unknown') + (typeof payload?.type === 'string' ? `/${payload.type}` : '')
    types.add(type)
    walk(event, type)
  }
  for (const sample of samples) for (const snapshot of sample.snapshots) {
    if ('jsonl' in snapshot.raw) for (const line of snapshot.raw.jsonl.split('\n').filter(Boolean)) add(JSON.parse(line))
    else {
      for (const row of snapshot.raw.messages) { const data = JSON.parse(row.data); add(data, `message/${data.role ?? 'unknown'}`) }
      for (const row of snapshot.raw.parts) { const data = JSON.parse(row.data); add(data, `part/${data.type ?? 'unknown'}`) }
    }
  }
  return { types, fields }
}

export function compareSamples(before: CliSample[], after: CliSample[]) {
  const a = shape(before), b = shape(after)
  const difference = (left: Set<string>, right: Set<string>) => [...left].filter((value) => !right.has(value)).sort()
  return { addedTypes: difference(b.types, a.types), removedTypes: difference(a.types, b.types), addedFields: difference(b.fields, a.fields), removedFields: difference(a.fields, b.fields) }
}
