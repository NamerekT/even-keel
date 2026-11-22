import { describe, expect, it } from 'vitest'
import { briefAccounts, folderHere, type FolderHere } from './account-here.js'

const CLAUDE_ACCOUNT = { agent: 'claude', account: 'account-1', email: 'john.doe@example.com' }

describe('briefAccounts', () => {
  it('names a Claude folder by its sign-in or its token, another agent by its e-mail, and leaves out one of nobody known', () => {
    const folders: FolderHere[] = [
      { key: 'main', agent: 'claude', signed: 'account-1', email: 'john.doe@example.com' },
      { key: 'token', agent: 'claude', token: 'account-2', email: null },
      { key: 'codex', agent: 'codex', email: 'john.doe@example.com' },
      { key: 'blank', agent: 'opencode', email: null },
    ]
    expect(briefAccounts(folders)).toEqual({
      main: { agent: 'claude', account: 'account-1', email: 'john.doe@example.com' },
      token: { agent: 'claude', account: 'account-2', email: null },
      codex: { agent: 'codex', email: 'john.doe@example.com' },
    })
  })
})

describe('folderHere', () => {
  it('keeps the key when the hub told nothing of the folder and one of that name is here', () => {
    expect(folderHere(undefined, 'main', [{ key: 'main', agent: 'claude', email: null }])).toBe('main')
  })

  it('finds none when the hub told nothing of the folder and none of that name is here', () => {
    const folders: FolderHere[] = [{ key: 'other', agent: 'claude', signed: 'account-1', email: 'john.doe@example.com' }]
    expect(folderHere(undefined, 'main', folders)).toBeNull()
  })

  it('takes the folder of the same name when it is of the same account', () => {
    const folders: FolderHere[] = [
      { key: 'other', agent: 'claude', signed: 'account-1', email: null },
      { key: 'main', agent: 'claude', token: 'account-1', email: null },
    ]
    expect(folderHere(CLAUDE_ACCOUNT, 'main', folders)).toBe('main')
  })

  it('takes a full sign-in of the account under another name before a long token of it', () => {
    const folders: FolderHere[] = [
      { key: 'token', agent: 'claude', token: 'account-1', email: null },
      { key: 'main-2', agent: 'claude', signed: 'account-1', email: 'john.doe@example.com' },
    ]
    expect(folderHere(CLAUDE_ACCOUNT, 'main', folders)).toBe('main-2')
  })

  it('takes a long token said to be of the account when no full sign-in of it is here', () => {
    const folders: FolderHere[] = [{ key: 'token', agent: 'claude', token: 'account-1', email: null }]
    expect(folderHere(CLAUDE_ACCOUNT, 'main', folders)).toBe('token')
  })

  it('refuses a folder of the same name signed in as another account', () => {
    const folders: FolderHere[] = [{ key: 'main', agent: 'claude', signed: 'account-2', email: 'jane.doe@example.com' }]
    expect(folderHere(CLAUDE_ACCOUNT, 'main', folders)).toBeNull()
  })

  it('matches another agent by its e-mail, whatever the case', () => {
    const folders: FolderHere[] = [
      { key: 'codex', agent: 'codex', email: 'jane.doe@example.com' },
      { key: 'codex-2', agent: 'codex', email: 'John.Doe@example.com' },
      { key: 'claude', agent: 'claude', signed: 'account-1', email: 'john.doe@example.com' },
    ]
    expect(folderHere({ agent: 'codex', email: 'john.doe@example.com' }, 'codex', folders)).toBe('codex-2')
  })

  it('keeps the key when the hub knows no e-mail and no account of the folder and one of that name and agent is here', () => {
    expect(folderHere({ agent: 'opencode', email: null }, 'opencode', [{ key: 'opencode', agent: 'opencode', email: null }])).toBe('opencode')
  })

  it('finds none when the hub knows nothing of the folder and the one of that name here is of another agent', () => {
    expect(folderHere({ agent: 'opencode', email: null }, 'opencode', [{ key: 'opencode', agent: 'codex', email: null }])).toBeNull()
  })
})
