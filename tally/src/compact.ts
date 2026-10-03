export const STRING_LIMIT = 2000

const DUPLICATE_KEYS = new Set(['toolUseResult', 'wireToolInputs', 'rendered'])

export function compact(line: object): unknown {
  return shrink(Object.fromEntries(Object.entries(line).filter(([name]) => !DUPLICATE_KEYS.has(name))))
}

function shrink(value: unknown, key?: string, parent?: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    if (key === 'signature' || (key === 'data' && parent?.type === 'base64')) return value.length
    return cut(value)
  }
  if (Array.isArray(value)) return value.map((item) => shrink(item))
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(record)) result[cleanText(name)] = shrink(item, name, record)
  return result
}

function cut(text: string): string {
  if (text.length <= STRING_LIMIT) return cleanText(text)
  let end = STRING_LIMIT
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return `${cleanText(text.slice(0, end))}…[+${text.length - end}]`
}

export function cleanText(text: string): string {
  return text.replaceAll('\u0000', '').toWellFormed()
}
