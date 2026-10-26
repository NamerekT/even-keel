import { describe, expect, it } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { forgetKeyOrganization, loadKeyOrganizations, saveKeyOrganization } from './organizations.js'

describe('the organizations of the API accounts (BTN-418)', { timeout: 30_000 }, () => {
  it('keeps the last one seen per account and forgets a removed account', async () => {
    const db = await memoryDatabase()
    expect(await loadKeyOrganizations(db)).toEqual(new Map())
    await saveKeyOrganization(db, 'work', 'org-old', new Date('2026-10-26T10:00:00.000Z'))
    await saveKeyOrganization(db, 'work', 'org-example', new Date('2026-10-26T11:00:00.000Z'))
    await saveKeyOrganization(db, 'codex-api', 'org-openai-example', new Date('2026-10-26T11:00:00.000Z'))
    expect(await loadKeyOrganizations(db)).toEqual(new Map([['codex-api', 'org-openai-example'], ['work', 'org-example']]))
    await forgetKeyOrganization(db, 'work')
    expect(await loadKeyOrganizations(db)).toEqual(new Map([['codex-api', 'org-openai-example']]))
  })
})
