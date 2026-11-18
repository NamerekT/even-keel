import { describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { AccountIdentities } from '../limits/identity.js'
import { foldersHere, type FoldersHereContext } from './folders-here.js'

describe('the account folders here (BTN-1311)', () => {
  it('reads each folder\'s e-mail without building the accounts\' view (BTN-1317)', () => {
    const homes = [{ key: 'main', agent: 'claude', dir: '/main' }, { key: 'cx', agent: 'codex', dir: '/cx' }] as AccountHome[]
    const ctx: FoldersHereContext = {
      homes: { list: () => homes, configFile: (home) => `${home.dir}/.claude.json` },
      account: { shownEmailOf: (key) => (key === 'cx' ? 'john@example.com' : null), longToken: () => undefined },
    }
    const identities = new AccountIdentities({ read: () => JSON.stringify({ oauthAccount: { accountUuid: 'u-1', emailAddress: 'jane@example.com' } }) })
    expect(foldersHere(ctx, identities)).toEqual([
      { key: 'main', agent: 'claude', email: 'jane@example.com', signed: 'u-1' },
      { key: 'cx', agent: 'codex', email: 'john@example.com' },
    ])
  })
})
