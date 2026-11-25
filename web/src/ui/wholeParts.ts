/** The pieces a value may wrap between (BTN-1564): a path after each `/` or `\`, anything else nowhere. */
export function wholeParts(text: string, path: boolean): string[] {
  if (!path) return [text]
  const parts = text.split(/(?<=[/\\])/)
  return parts.filter((part, index) => part !== '' || index === 0)
}
