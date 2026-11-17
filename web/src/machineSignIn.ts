import type { AccountEntry } from '../../src/account/model.js'
import type { MachineSignIn } from '../../src/state.js'
import { paysPerToken } from './accounts.js'
import type { Send } from './layout/accountParts.js'

/** A machine elsewhere where a hub account is not signed in (BTN-1245): the line under the account and its button. */
export interface MachineGap {
  machine: string
  name: string
  online: boolean
  /** The machine's own folder of the account, signed out: signed in again there; absent — a new account there. */
  account?: string
  /** The machine has no CLI of the account's agent: nothing to sign in with. */
  noCli: boolean
}

const sameEmail = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase()

/**
 * The machines elsewhere where the hub's account is not signed in. Only a subscription the person signs in to in a
 * browser counts, known by its e-mail: a key, a cloud or a long token is not carried to a machine this way.
 */
export function machineGaps(entry: AccountEntry, machines: MachineSignIn[] | undefined): MachineGap[] {
  const email = entry.status?.loggedIn === true ? entry.status.email : null
  if (email === null || paysPerToken(entry) || entry.longToken !== undefined) return []
  return (machines ?? []).flatMap((machine) => {
    const own = machine.accounts.filter((each) => each.agent === entry.agent && sameEmail(each.email, email))
    if (own.some((each) => each.signedIn)) return []
    const folder = own[0]?.key ?? machine.accounts.find((each) => each.agent === entry.agent && each.key === entry.key)?.key
    return [{
      machine: machine.machine,
      name: machine.name,
      online: machine.online,
      ...(folder !== undefined && { account: folder }),
      noCli: machine.missing.includes(entry.agent),
    }]
  })
}

/** The machine's sign-in under way, the first if several; `undefined` — none. */
export function machineLogin(machines: MachineSignIn[] | undefined): MachineSignIn | undefined {
  return machines?.find((machine) => machine.login !== null)
}

/**
 * The sign-in steps' commands, made for the machine: they go to the hub, which hands them to that machine. "Try again"
 * of the steps renews the folder it signed in to or adds the same agent anew.
 */
export function machineSend(machine: string, send: Send): Send {
  return (name, body = {}) => {
    if (name === 'account/code') return send('machines/code', { machine, code: body.code })
    if (name === 'account/cancel') return send('machines/cancel', { machine })
    if (name === 'account/renew') return send('machines/login', { machine, account: body.account, ...(body.agent !== undefined && { agent: body.agent }) })
    if (name === 'account/add') return send('machines/login', { machine, ...body })
    return send(name, body)
  }
}
