import { fail } from '../notice/notice.js'
import type { ProfileDraft } from './service.js'

/** A profile draft from the page's body: `kind`, `values` of strings or `null`, and `id` of a stored profile. */
export function profileDraftOf(body: Record<string, unknown>): ProfileDraft {
  if (typeof body.kind !== 'string' || body.kind === '') throw fail('request.required', { field: 'kind' })
  const raw = body.values
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('request.required', { field: 'values' })
  const values: Record<string, string | null> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'string' && value !== null) throw fail('request.required', { field: `values.${name}` })
    values[name] = value
  }
  if (body.id !== undefined && (typeof body.id !== 'string' || body.id === '')) throw fail('request.required', { field: 'id' })
  return { ...(body.id === undefined ? {} : { id: body.id }), kind: body.kind, values }
}
