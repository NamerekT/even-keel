import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../i18n/index.js'
import { loginAccess, type FolderWay } from '../machineSignIn.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CloseIcon, KeyIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { AgentIcon, type Send } from './accountParts.js'
import { SignIn } from './MachineAccounts.js'
import { MachineKeyDialog } from './MachineKey.js'
import '../tools/addPackage.css'
import './machineAccounts.css'

export interface FolderSignInProps {
  machine: { id: string; name: string; online: boolean }
  agent: string
  /** The machine's signed-out folder. */
  folder: string
  way: FolderWay
  busy: boolean
  /** The agent's name when the machine has no CLI of it. */
  noCli: string | null
  /** The hub's commands: `machines/login`, `machines/account/remove`. */
  send: Send
}

/**
 * The end of a machine's signed-out folder's row (BTN-1585): a subscription's "Sign in" there; a key's, a cloud's or a
 * long token's folder says so in place of a browser sign-in, which would put some subscription into it, a key's with
 * "Enter key" beside (BTN-1684); one whose way neither the machine nor the hub knows asks it first.
 */
export function FolderSignIn({ machine, agent, folder, way, busy, noCli, send }: FolderSignInProps) {
  const view = t.machinePanel.view
  const [asking, setAsking] = useState<'way' | 'key' | 'remove' | null>(null)
  const login = () => void send('machines/login', { machine: machine.id, agent, account: folder })
  const removal = asking === 'remove' && (
    <ConfirmDialog title={folder} question={way === 'token' ? t.account.removeNow : t.account.removeKeyNow} confirm={t.common.remove} cancel={t.account.keep}
      busy={busy} onClose={() => setAsking(null)}
      onConfirm={() => void send('machines/account/remove', { machine: machine.id, account: folder }).then((ok) => { if (ok) setAsking(null) })} />
  )
  // A folder of unknown way may still go instead, from the key's own window.
  const keying = asking === 'key' && (
    <MachineKeyDialog machine={machine} agent={agent} folder={folder} busy={busy} onClose={() => setAsking(null)}
      extra={way === 'unknown' && <button type="button" className="button button--danger" disabled={busy} onClick={() => setAsking('remove')}>{view.keyRemove}</button>} />
  )
  const enter = <button type="button" className="button button--small" disabled={busy || !machine.online} onClick={() => setAsking('key')}>{view.keyEnter}</button>
  if (way === 'subscription') return <SignIn name={machine.name} online={machine.online} busy={busy} noCli={noCli} onClick={login} />
  if (way === 'unknown') {
    return <>
      <SignIn name={machine.name} online={machine.online} busy={busy} noCli={noCli} onClick={() => setAsking('way')} />
      {asking === 'way' && <FolderWayDialog machine={machine.name} agent={agent} folder={folder} busy={busy} onClose={() => setAsking(null)}
        onSubscription={() => { setAsking(null); login() }} onKey={() => setAsking('key')} />}
      {keying}
      {removal}
    </>
  }
  return <span className="machine-accounts__end machine-accounts__way">
    <Tipped className="machine-accounts__muted" tip={way === 'key' ? view.keyFolderTip(machine.name) : view.tokenFolderTip(machine.name)} align="end" focusable>
      {way === 'key' ? view.keyFolder : view.tokenFolder}
    </Tipped>
    {way === 'key' && (machine.online ? enter : <Tipped tip={view.accountsOffline(machine.name)} align="end">{enter}</Tipped>)}
    {keying}
  </span>
}

interface WayProps {
  machine: string
  agent: string
  folder: string
  busy: boolean
  onSubscription: () => void
  onKey: () => void
  onClose: () => void
}

/** How a folder the machine finds no sign-in in signs in: a subscription in a browser, or a key entered here. */
function FolderWayDialog({ machine, agent, folder, busy, onSubscription, onKey, onClose }: WayProps) {
  const view = t.machinePanel.view
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
    dialog.current?.querySelector<HTMLElement>('.add-package__kind')?.focus()
  }, [])
  return (
    <dialog ref={dialog} className="add-package" aria-labelledby={heading} {...backdrop}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}>
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">{view.wayTitle(folder, machine)}</h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="add-package__body">
          <p className="add-package__lead">{view.wayLead(machine)}</p>
          <div className="add-package__kinds account-add__providers">
            <button type="button" className="add-package__kind" disabled={busy} onClick={onSubscription}>
              <span className="add-package__kind-icon"><AgentIcon agent={agent} /></span>
              <span className="add-package__kind-title">{t.account.access[loginAccess(agent)]}</span>
              <span className="add-package__kind-desc">{view.waySubscription(machine)}</span>
            </button>
            <button type="button" className="add-package__kind" disabled={busy} onClick={onKey}>
              <span className="add-package__kind-icon"><KeyIcon /></span>
              <span className="add-package__kind-title">{view.wayKey}</span>
              <span className="add-package__kind-desc">{view.wayKeyGets}</span>
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
