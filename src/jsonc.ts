/** JSON with comments and trailing commas, as OpenCode reads its config and Copilot writes its own; `undefined` when it is not even that or not an object. */
export function parseJsonc(text: string): Record<string, unknown> | undefined {
  const bare = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, string: string | undefined) => string ?? '').replace(/,(\s*[}\]])/g, '$1')
  try {
    const value: unknown = JSON.parse(bare)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** The `//` comment lines a file opens with, kept when the file is written back. */
export function leadingComments(text: string): string {
  return /^(?:[ \t]*\/\/[^\n]*\n)*/.exec(text.replace(/\r\n/g, '\n'))?.[0] ?? ''
}
