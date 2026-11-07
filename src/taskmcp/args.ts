import { EditRefused, type TextPatch } from '../tracker/editor.js'
import { PRIORITIES, type TaskPriority } from '../tracker/model.js'

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
