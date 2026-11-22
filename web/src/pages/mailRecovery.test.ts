import { expect, it } from 'vitest'
import type { Mail } from '../../../src/sessions/mail.js'
import { recoverMail, rememberUpload } from './mailRecovery.js'

it('restores the matching bytes when the second of two identical uploads comes back first', () => {
  const first = new File(['one'], 'notes.txt')
  const second = new File(['two'], 'notes.txt')
  const uploads = rememberUpload({ text: '', files: [first] }, 'session', [])
  const recovery = rememberUpload({ text: '', files: [second], recovery: uploads }, 'session', [])
  const letter: Mail = { id: 1, sessionId: 'session', task: 'ABC-1', files: ['notes.txt'], text: '',
    postedAt: '10:00', settledAt: null, event: null, reason: null, fate: 'waiting' }
  const mail = [letter, { ...letter, id: 2, files: ['notes (2).txt'], fate: 'returned' as const }]
  const restored = recoverMail({ text: '', files: [], recovery }, 'session', mail)
  expect(restored.files[0]).toBe(second)
  expect(restored.recovery?.uploads[0]?.files[0]).toBe(first)
  expect(recoverMail(restored, 'session', mail)).toBe(restored)
})
