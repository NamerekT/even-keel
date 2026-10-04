import { fail } from '../notice/notice.js'

const PLACEHOLDER =/\$\{[^}]*\}|\{\{[^}]*\}\}|\{\s*[A-Za-z_][\w.-]*\s*\}/

export function fill(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce((text, part, index) => {
    if (index === 0) return part
    const value: unknown = values[index - 1]
    if (typeof value !== 'string' || value.trim() === '') {
      throw fail('prompt.empty', { before: text.slice(-40), value: JSON.stringify(value) ?? String(value) })
    }
    return text + value + part
  }, '')
}

export function placeholderIn(text: string): string | null {
  return PLACEHOLDER.exec(text)?.[0] ?? null
}
