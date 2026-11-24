import { hubFolderOf } from '../../../src/account/same-account.js'
import { fail } from '../../../src/notice/notice.js'
import type { EvenKeelState, MachineCard } from '../../../src/state.js'

/** How long a removal on a machine waits for the account's session there (BTN-1584). */
export const FAKE_MACHINE_REMOVE_MS = 6000

/** The session an account runs on the machine while its removal waits. */
const RUNNING = 'ABC-12'

type HubCommand = (name: string, body: Record<string, unknown>) => EvenKeelState

/**
 * What the row menu of a machine elsewhere's view changes on the fake's machines (BTN-1584): folders removed or waiting
 * for their session, names of folders the hub has no account of, the account VS Code runs on there.
 */
export class FakeMachineAccounts {
  private readonly removed = new Set<string>()
  private readonly removing = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly names = new Map<string, string | null>()
  private readonly vscode = new Map<string, string>()

  constructor(private readonly changed: () => void) {}

  /** A card's accounts and apps with the changes on its machine. */
  apply(id: string, accounts: MachineCard['accounts']): Pick<MachineCard, 'accounts' | 'apps'> {
    const left = accounts.filter((each) => !this.removed.has(at(id, each.key))).map((each) => {
      const name = this.names.get(at(id, each.key))
      const waiting = this.removing.has(at(id, each.key))
      return { ...each, ...(name !== undefined && { name }), ...(waiting && { removing: true as const, sessions: [RUNNING] }) }
    })
    const picked = this.vscode.get(id)
    const vscode = left.find((each) => each.key === picked) ?? left.find((each) => each.agent === 'claude' && each.signedIn)
    return { accounts: left, apps: [{ app: 'vscode', account: vscode?.key ?? null, dir: null, error: null, sessions: [] }] }
  }

  /**
   * A `machines/account/*` command on the machine of `cards`; `undefined` — another command. The name of an account
   * the hub has a folder of and Even Keel's account are the hub's: `hub` runs its own command on that folder.
   */
  command(state: EvenKeelState, cards: MachineCard[], name: string, body: Record<string, unknown>, hub: HubCommand): EvenKeelState | undefined {
    if (!name.startsWith('machines/account/')) return undefined
    const card = cards.find((each) => each.id === body.machine)
    const account = card?.accounts.find((each) => each.key === body.account)
    if (card === undefined || account === undefined) throw fail('machines.unknown', {})
    if (!card.online) throw fail('machines.accountsOffline', { name: card.name })
    const key = at(card.id, account.key)
    const owner = account.email === null ? undefined : hubFolderOf(state.account.accounts, account.agent, account.email)
    const done = (next: EvenKeelState = state) => { this.changed(); return next }
    switch (name) {
      case 'machines/account/remove':
        this.removing.set(key, setTimeout(() => {
          this.removing.delete(key)
          this.removed.add(key)
          this.changed()
        }, FAKE_MACHINE_REMOVE_MS))
        return done()
      case 'machines/account/keep':
        clearTimeout(this.removing.get(key))
        this.removing.delete(key)
        return done()
      case 'machines/account/app':
        this.vscode.set(card.id, account.key)
        return done()
      case 'machines/account/name':
        if (owner !== undefined) return done(hub('account/name', { account: owner.key, name: body.name }))
        this.names.set(key, String(body.name ?? '').trim() || null)
        return done()
      case 'machines/account/switch':
        if (owner === undefined) throw fail('machines.accountNotOnHub', { name: card.name, account: account.email ?? account.key })
        return done(hub('account/switch', { account: owner.key }))
      default:
        return undefined
    }
  }
}

const at = (machine: string, folder: string) => `${machine}\n${folder}`
