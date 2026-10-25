import type { TranscriptImage } from '../sessions/entry.js'

/** Both direct tools and code-mode wrappers store the pictures as data URLs in their result. */
export function rolloutImages(payload: Record<string, unknown>): TranscriptImage[] {
  if (payload.type !== 'custom_tool_call_output' && payload.type !== 'function_call_output') return []
  if (!Array.isArray(payload.output)) return []
  return payload.output.flatMap((block: unknown) => {
    if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'input_image') return []
    if (!('image_url' in block) || typeof block.image_url !== 'string') return []
    const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(block.image_url)
    return match === null ? [] : [{ type: match[1]!, data: match[2]! }]
  })
}

/** A name only when a call identifies one static path; never evaluate the wrapper's JavaScript. */
export function rolloutImagePath(payload: Record<string, unknown>): string {
  const name = typeof payload.name === 'string' ? payload.name.split('.').at(-1) : undefined
  if (payload.type === 'function_call' && name === 'view_image' && typeof payload.arguments === 'string') {
    try {
      const input: unknown = JSON.parse(payload.arguments)
      return typeof input === 'object' && input !== null && 'path' in input && typeof input.path === 'string' ? input.path : ''
    } catch {
      return ''
    }
  }
  if (payload.type !== 'custom_tool_call' || name !== 'exec' || typeof payload.input !== 'string') return ''
  if ([...payload.input.matchAll(/\btools\.view_image\s*\(/g)].length !== 1) return ''
  const match = /\btools\.view_image\s*\(\s*\{\s*(?:path|"path"|'path')\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*[,}]/.exec(payload.input)
  if (match === null) return ''
  const literal = match[1]!
  if (literal.startsWith('`') && literal.includes('${')) return ''
  try {
    const body = literal.slice(1, -1).replace(/\\(.)|"/gs, (text, escaped: string | undefined) => {
      if (escaped === "'" || escaped === '`') return escaped
      return text === '"' ? '\\"' : text
    })
    return JSON.parse(`"${body}"`) as string
  } catch {
    return ''
  }
}
