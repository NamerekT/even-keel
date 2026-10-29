const ID_KEY = /^(?:id|uuid|(?:session|parent|message|call|toolUse|toolCall|request|turn|thread|agent)[_-]?id)$/i
const SECRET_KEY = /(?:token|secret|password|authorization|api[_-]?key|secret[_-]?key|credential|signature)$/i
const PERSON_KEY = /^(?:hostname|host_name|machine|computername|username|user_name|email)$/i
const UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi
const TOKEN = /\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g
const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi
const PATH = /(?:[a-z]:[\\/]|\\\\[^\\\s]+\\|(?<![\w:/])\/(?=[\w.~@-]))[^\s"'`<>|;,)}\]]*/gi

/** The same replacement map covers raw events, embedded JSON and the live expectations. */
export function anonymizeSample<T>(value: T, privateValues: string[] = []): T {
  const replacements = new Map<string, string>()
  const dynamicKeys = new Set<string>()
  let sequence = 0
  const keep = (source: string, kind: string): string => {
    if (!replacements.has(source)) replacements.set(source, kind === 'email' ? `person-${++sequence}@example.com` :
      kind === 'path' ? `/example/path-${++sequence}${/[\\/]answer\.txt$/.test(source) ? '/answer.txt' : ''}` : `example-${kind}-${++sequence}`)
    return replacements.get(source)!
  }
  const privateSources = new Set(privateValues.filter((text) => text.length > 0))
  for (const text of privateSources) keep(text, 'private')
  const parse = (text: string): unknown => { try { return JSON.parse(text) } catch { return undefined } }
  const collect = (item: unknown, key = '', parent = ''): void => {
    if (typeof item === 'string') {
      const nested = parse(item)
      if (nested !== undefined && typeof nested === 'object') collect(nested)
      else if (item.includes('\n')) for (const line of item.split('\n')) { const event = parse(line); if (event !== undefined) collect(event) }
      if (ID_KEY.test(key) && item !== '' && !/^[a-z]+$/i.test(item)) keep(item, 'id')
      // Token counts are numbers/objects. Only credential values are replaced here.
      if (SECRET_KEY.test(key) && item !== '') keep(item, 'secret')
      if ((PERSON_KEY.test(key) || (key === 'name' && /author|user|account|owner|person/i.test(parent))) && item !== '') keep(item, key.toLowerCase() === 'email' ? 'email' : 'person')
      for (const match of item.matchAll(UUID)) keep(match[0], 'id')
    } else if (Array.isArray(item)) item.forEach((entry) => collect(entry))
    else if (item !== null && typeof item === 'object') for (const [name, entry] of Object.entries(item)) {
      for (const match of name.matchAll(UUID)) { keep(match[0], 'id'); dynamicKeys.add(name) }
      for (const match of name.matchAll(EMAIL)) { keep(match[0], 'email'); dynamicKeys.add(name) }
      if (/^(?:ses|msg|toolu|call|prt)_[\w-]+$/.test(name)) { keep(name, 'id'); dynamicKeys.add(name) }
      collect(entry, name, key)
    }
  }
  collect(value)
  const cleanText = (text: string): string => {
    if (replacements.has(text)) return replacements.get(text)!
    text = text.replace(/(?:https?|file):\/\/[^\s"'<>]+/gi, 'https://example.com/redacted')
      .replace(PATH, (path) => keep(path, 'path')).replace(EMAIL, (email) => keep(email, 'email'))
      .replace(/Bearer\s+\S+/gi, 'Bearer example-secret').replace(TOKEN, 'example-secret')
    const sources = [...replacements.keys()].filter((source) => source.length >= 8 || privateSources.has(source)).sort((a, b) => b.length - a.length)
    const pattern = sources.map((source) => {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return source.length >= 8 ? escaped : `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
    }).join('|')
    return pattern === '' ? text : text.replace(new RegExp(pattern, 'gu'), (source) => replacements.get(source)!)
  }
  const clean = (item: unknown): unknown => {
    if (typeof item === 'string') {
      const nested = parse(item)
      if (nested !== undefined && typeof nested === 'object') return JSON.stringify(clean(nested))
      if (item.includes('\n')) return item.split('\n').map((line) => {
        const event = parse(line)
        return event !== undefined && typeof event === 'object' ? JSON.stringify(clean(event)) : cleanText(line)
      }).join('\n')
      return cleanText(item)
    }
    if (Array.isArray(item)) return item.map(clean)
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [dynamicKeys.has(key) ? cleanText(key) : key, clean(entry)]))
    return item
  }
  return clean(value) as T
}
