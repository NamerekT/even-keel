import type { Mail } from '../../../src/sessions/mail.js'
import type { Draft } from './chatDraft.js'
import { matchesUpload } from './sentLines.js'

/** Kept in the same IndexedDB record as the draft so a return survives a closed window or a reload. */
export interface MailRecovery {
  uploads: { session: string; afterMail: number; text: string; files: File[]; at: number }[]
  restored: string[]
}

export function rememberUpload(draft: Draft, session: string, mail: Mail[]): MailRecovery {
  const since = Date.now() - 7 * 24 * 60 * 60_000
  const uploads = (draft.recovery?.uploads ?? []).filter(each => each.at >= since)
  return {
    uploads: [...uploads, { session, afterMail: Math.max(0, ...mail.map(each => each.id)), text: draft.text, files: draft.files, at: Date.now() }],
    restored: draft.recovery?.restored ?? [],
  }
}

export function recoverMail(draft: Draft, session: string, mail: Mail[]): Draft {
  const uploads = [...(draft.recovery?.uploads ?? [])]
  const restored = [...(draft.recovery?.restored ?? [])]
  const texts: string[] = []
  const files: File[] = []
  let changed = false
  // A waiting letter holds its upload too, so a later letter with a renamed duplicate cannot take its bytes.
  const held = new Set<MailRecovery['uploads'][number]>()
  for (const letter of [...mail].sort((a, b) => a.id - b.id)) {
    const key = JSON.stringify([session, letter.id, letter.postedAt])
    if (restored.includes(key)) continue
    const index = uploads.findIndex(each => each.session === session && each.afterMail < letter.id && !held.has(each) &&
      matchesUpload({ text: each.text, files: each.files.map(file => file.name) }, letter))
    if (letter.fate === 'waiting') {
      if (index >= 0) held.add(uploads[index]!)
      continue
    }
    const upload = index < 0 ? undefined : uploads.splice(index, 1)[0]
    if (!upload && letter.fate !== 'returned') continue
    changed = true
    restored.push(key)
    if (letter.fate !== 'returned') continue
    texts.push(upload?.text ?? letter.text)
    if (upload) files.push(...upload.files)
    // On a different browser the original bytes are unavailable. The session can still use its saved paths.
    else texts.push(...letter.files)
  }
  return changed ? {
    ...draft, text: [...texts, draft.text].filter(Boolean).join('\n\n'), files: [...files, ...draft.files],
    recovery: { uploads, restored },
  } : draft
}
