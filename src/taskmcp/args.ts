import { EditRefused, type TextPatch } from '../tracker/editor.js'
import { PRIORITIES, type TaskPriority } from '../tracker/model.js'
import { toolSpecs } from './tools.js'

interface ArgumentSchema {
  properties?: Record<string, ArgumentSchema>
  items?: ArgumentSchema
}

// The unscoped schema with every capability contains all names known to any session.
const schemas = new Map(toolSpecs(false).map((tool) => [tool.name, tool.inputSchema as ArgumentSchema]))

/** Checks names before any tracker, file or retry access, without changing the existing type coercions. */
export function checkToolArgs(name: string, raw: Record<string, unknown>): void {
  const schema = schemas.get(name)
  if (schema === undefined) throw new EditRefused(`there is no tool ${name}`)
  const refused: string[] = []
  const check = (value: unknown, properties: Record<string, ArgumentSchema>, prefix: string, singular: string, plural: string, allowed: string) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return
    const known = Object.keys(properties)
    const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key))
    if (unknown.length > 0) {
      refused.push(`${prefix}${unknown.map((key) => JSON.stringify(key)).join(', ')} ${unknown.length === 1 ? singular : plural}; ${allowed} ${known.join(', ')}`)
    }
  }
  const properties = schema.properties!
  check(raw, properties, '', `is not a parameter of ${name}`, `are not parameters of ${name}`, 'its parameters are')
  for (const [field, spec] of Object.entries(properties)) {
    if (spec.items?.properties === undefined || raw[field] === undefined) continue
    const value = raw[field]
    const items = Array.isArray(value) ? value : [value]
    const noun = field === 'tasks' ? 'task' : 'replacement'
    items.forEach((item, index) => check(item, spec.items!.properties!, `${field} #${index + 1}: `, `is not a field of a ${noun}`, `are not fields of a ${noun}`, 'its fields are'))
  }
  if (refused.length > 0) throw new EditRefused(refused.join('\n'))
}

/** A tool's arguments as the agent sent them; each getter refuses a wrong type with a line the agent can act on. */
export class Args {
  constructor(private readonly raw: Record<string, unknown>) {}

  has(name: string): boolean {
    return this.raw[name] !== undefined
  }

  text(name: string): string | undefined {
    const value = this.raw[name]
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw new EditRefused(`"${name}" must be a string`)
    return value
  }

  required(name: string): string {
    const value = this.text(name)
    if (value === undefined || value.trim() === '') throw new EditRefused(`"${name}" is required`)
    return value
  }

  /** A string, `null` to clear, `undefined` when absent. */
  nullable(name: string): string | null | undefined {
    return this.raw[name] === null ? null : this.text(name)
  }

  texts(name: string): string[] {
    const value = this.raw[name]
    if (value === undefined) return []
    if (typeof value === 'string') return [value]
    if (!Array.isArray(value) || value.some((each) => typeof each !== 'string')) throw new EditRefused(`"${name}" must be a list of strings`)
    return value as string[]
  }

  flag(name: string): boolean {
    const value = this.raw[name]
    return value === true || value === 'true'
  }

  integer(name: string): number | undefined {
    const value = this.raw[name]
    if (value === undefined) return undefined
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new EditRefused(`"${name}" must be an integer`)
    return number
  }

  priority(name: string): TaskPriority | undefined {
    const value = this.text(name)?.trim().toLowerCase()
    if (value === undefined) return undefined
    if (!(PRIORITIES as readonly string[]).includes(value)) throw new EditRefused(`there is no priority "${value}"; the priorities are ${PRIORITIES.join(', ')}`)
    return value as TaskPriority
  }

  /** `{ add, remove }` lists. */
  change(name: string): { add: string[]; remove: string[] } {
    const value = this.raw[name]
    if (value === undefined) return { add: [], remove: [] }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new EditRefused(`"${name}" must be {add, remove}`)
    const inner = new Args(value as Record<string, unknown>)
    return { add: inner.texts('add'), remove: inner.texts('remove') }
  }

  patches(name: string): TextPatch[] {
    const value = this.raw[name]
    if (value === undefined) return []
    const list = Array.isArray(value) ? value : [value]
    return list.map((each, index) => {
      if (typeof each !== 'object' || each === null) throw new EditRefused(`"${name}" item ${index + 1} must be {old, new}`)
      const { old, new: next } = each as { old?: unknown; new?: unknown }
      if (typeof old !== 'string' || typeof next !== 'string') throw new EditRefused(`"${name}" item ${index + 1} must have "old" and "new" strings`)
      return { old, new: next }
    })
  }

  objects(name: string): Args[] {
    const value = this.raw[name]
    if (!Array.isArray(value) || value.length === 0) throw new EditRefused(`"${name}" must be a non-empty list`)
    return value.map((each, index) => {
      if (typeof each !== 'object' || each === null || Array.isArray(each)) throw new EditRefused(`"${name}" item ${index + 1} must be an object`)
      return new Args(each as Record<string, unknown>)
    })
  }
}
