import { readFileSync } from 'node:fs'
import type { HookInput } from './rule-hook.js'

export const INSTRUCTION_LIMIT = 13000
export const isInstructionFile = (path: string) => /(?:^|[/\\])(?:CLAUDE|AGENTS)\.md$/i.test(path)

export function editedInstructionSize(input: HookInput, path: string): { before: number; after: number } | null {
  if (!isInstructionFile(path)) return null
  const original = input.tool_response?.originalFile
  const before = typeof original === 'string' ? Buffer.byteLength(original) : input.tool_response?.type === 'create' ? 0 : null
  if (before === null) return null
  try {
    return { before, after: readFileSync(path).length }
  } catch {
    return null
  }
}

export function instructionSizeNotice(files: Record<string, number>): string {
  return `Instruction files grew beyond the ${INSTRUCTION_LIMIT}-byte ceiling: ${Object.entries(files).map(([path, bytes]) => `${path} (${bytes} bytes)`).join(', ')}. ` +
    "Move architecture details, history, task IDs and measurements into the area's document or JSDoc. " +
    'Keep principles and traps without which any task would go wrong. Do not compress prose into telegraph style or discard a needed rule for space. ' +
    'Only the user may raise the ceiling. Reduce the files; edits are still allowed.'
}
