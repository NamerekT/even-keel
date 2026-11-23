import { useState, type FormEvent } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import type { MachineSignIn } from '../../../src/state.js'
import type { Sign } from '../accountAdd.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { sharedTokens, tokenAccounts } from '../machineAdd.js'
import { CommandBlock } from '../ui/blocks.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { KeyIcon } from '../ui/icons.js'
import { secretInput } from '../ui/secret.js'
import { Select } from '../ui/Select.js'
import { SignWays } from './SignFields.js'
import './machineAccounts.css'

interface Props {
  machine: MachineSignIn
  /** The hub's accounts: a long token there is offered as it is, a new one is tied to one of them. */
  accounts: AccountEntry[]
  busy: boolean
  /** The full sign-in's refusal, sent by the window. */
  failure: string | null
  back: () => void
  onFull: () => void
  /** The machine took a long token: the account is there. */
  onAdded: () => void
}

/**
 * How Claude signs in on a machine elsewhere (BTN-1501): the hub's two cards, a full sign-in through the CLI there or
 * a long token. The token is first one the hub runs on, sent by its folder alone (`machines/sharedToken`), then a new
 * one of `claude setup-token` tied to a hub subscription not signed in there (`machines/token`, BTN-1002).
 */
export function MachineClaudeSign({ machine, accounts, busy, failure, back, onFull, onAdded }: Props) {
  const words = t.addAccount.onMachine
  const [sign, setSign] = useState<Sign>('full')
  const shared = sharedTokens(accounts, machine, Date.now())
  const tied = tokenAccounts(accounts, machine)
  const [account, setAccount] = useState(tied[0]?.account ?? '')
  const [token, setToken] = useState('')
  const [via, setVia] = useState<'shared' | 'paste' | null>(null)
  const { send, sending, failure: refused } = useCommand()
  const working = busy || sending
  const who = tied.find((each) => each.account === account)?.who ?? ''
  const pasting = sign === 'token' && tied.length > 0

  const share = async (from: string) => {
    setVia('shared')
    if (await send('machines/sharedToken', { machine: machine.machine, from })) onAdded()
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (working) return
    if (sign === 'full') return onFull()
    if (!pasting || token.trim() === '') return
    setVia('paste')
    if (await send('machines/token', { machine: machine.machine, account, token })) onAdded()
  }
  const band = sign === 'full' ? failure : via === 'shared' && refused !== null ? say(refused) : null

  return (
    <form className="add-package__form" onSubmit={(event) => void submit(event)}>
      <div className="add-package__body">
        <SignWays sign={sign} tied={tied.length > 0} onSign={setSign} />
        {sign === 'token' && shared.length > 0 && (
          <div className="add-package__field">
            <span className="add-package__label">{words.shared}</span>
            <div className="machine-sign__shared">
              {shared.map((each) => (
                <button key={each.from} type="button" className="button machine-sign__same" disabled={working} onClick={() => void share(each.from)}>
                  <KeyIcon />
                  <span>{words.same(each.who)}</span>
                </button>
              ))}
            </div>
            <p className="add-package__note">{words.sharedNote}</p>
          </div>
        )}
        {sign === 'token' && !pasting && <p className="add-package__note">{t.addAccount.place.tokenNone(machine.name)}</p>}
        {pasting && (
          <>
            {shared.length > 0 && <span className="add-package__label">{words.fresh}</span>}
            {tied.length > 1 && (
              <div className="add-package__field">
                <span className="add-package__label">{t.account.machineTokenOf}</span>
                <Select
                  className="add-package__input"
                  label={t.account.machineTokenOf}
                  value={account}
                  options={tied.map((each) => ({ value: each.account, label: each.who }))}
                  onChange={setAccount}
                />
              </div>
            )}
            <p className="add-package__note">{t.account.machineTokenLead(who)}</p>
            <CommandBlock command="claude setup-token" />
            <label className="add-package__field">
              <span className="add-package__label">{t.account.newKey.longToken}</span>
              <FieldStrip line={via === 'paste' && refused !== null ? { tone: 'error', text: say(refused) } : null} fold wide>
                <input
                  className="add-package__input add-package__input--mono"
                  {...secretInput()}
                  value={token}
                  aria-invalid={via === 'paste' && refused !== null}
                  onChange={(event) => setToken(event.target.value)}
                />
              </FieldStrip>
            </label>
            <p className="add-package__note">{t.account.machineTokenLacks}</p>
          </>
        )}
      </div>
      {band !== null && <p role="alert" className="notice notice--error add-package__failure">{band}</p>}
      <footer className="add-package__foot">
        <button type="button" className="button" disabled={working} onClick={back}>
          ← {t.account.back}
        </button>
        <span className="add-package__spacer" />
        {sign === 'full' && (
          <button type="submit" className="button button--primary" disabled={working}>
            {words.signIn}
          </button>
        )}
        {pasting && (
          <button type="submit" className="button button--primary" disabled={working || token.trim() === ''}>
            {t.account.machineTokenAdd}
          </button>
        )}
      </footer>
    </form>
  )
}
