import { AccountHomes, accountsRoot, codexAccountsRoot, copilotAccountsRoot, openCodeAccountsRoot } from './homes.js'
import { inTransaction, type Db } from '../storage/database.js'

/** Registration belongs to this installation; a CLI's own folder and credentials remain the CLI's. */
export async function openAccountHomes(db: Db, env: NodeJS.ProcessEnv): Promise<AccountHomes> {
  const { rows } = await db.query<{ account: string }>('select account from global_accounts')
  const registration = {
    keys: new Set(rows.map((row) => row.account)),
    save: async (key: string, added: boolean): Promise<void> => {
      await db.query(added ? 'insert into global_accounts (account) values ($1) on conflict do nothing' : 'delete from global_accounts where account = $1', [key])
    },
  }
  const homes = new AccountHomes(env, accountsRoot(env), codexAccountsRoot(env), openCodeAccountsRoot(env), copilotAccountsRoot(env), registration)
  const legacy = await db.query("select 1 from service_state where name = 'accounts.adoptLegacy'")
  if (legacy.rows.length > 0) {
    const visible = homes.availableGlobals()
    await inTransaction(db, async (tx) => {
      for (const home of visible) await tx.query('insert into global_accounts (account) values ($1) on conflict do nothing', [home.key])
      await tx.query("delete from service_state where name = 'accounts.adoptLegacy'")
    })
    for (const home of visible) registration.keys.add(home.key)
  }
  return homes
}
