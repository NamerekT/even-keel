import { useEffect, useId, useRef } from 'react'
import type { MachineCard, MachineSignIn } from '../../../src/state.js'
import { machineAddChoices, type MachineAddChoice } from '../machineAdd.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Tipped } from '../ui/Tipped.js'
import { AgentIcon } from './accountParts.js'
import '../tools/addPackage.css'
import './accountAdd.css'
import './machineAccounts.css'

const gets = ({ agent, method }: MachineAddChoice): string =>
  (t.addAccount.way as unknown as Record<string, Record<string, { gets: string } | undefined> | undefined>)[agent]?.[method ?? 'subscription']?.gets ?? ''

/**
 * "Add account" of a machine elsewhere (BTN-1302): the agent, as on the hub, an agent whose CLI the machine lacks off
 * with why; the pick sends `machines/login` without a folder, and `MachineLoginDialog` follows the sign-in there.
 */
export function MachineAddAccount({ card, signIn, onClose }: { card: Pick<MachineCard, 'id' | 'name'>; signIn: MachineSignIn | undefined; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const { send, sending, failure } = useCommand()
  const view = t.machinePanel.view

  useEffect(() => {
    if (dialog.current?.open !== false) return
    dialog.current.showModal()
    dialog.current.querySelector<HTMLElement>('.add-package__kind:not([aria-disabled])')?.focus()
  }, [])

  const pick = async ({ agent, method }: MachineAddChoice) => {
    if (await send('machines/login', { machine: card.id, agent, ...(method !== undefined && { method }) })) onClose()
  }

  return (
    <dialog
      ref={dialog}
      className="add-package"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">{view.addTitle(card.name)}</h2>
          <button type="button" className="panel__close" aria-label={t.machines.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <p className="add-package__note">{view.addLead}</p>
          <div className="add-package__kinds account-add__providers machine-add__agents">
            {machineAddChoices(signIn).map((choice) => {
              const tile = (
                <button
                  type="button"
                  className="add-package__kind"
                  {...(choice.missing ? { 'aria-disabled': 'true' as const } : { disabled: sending, onClick: () => void pick(choice) })}
                >
                  <span className="add-package__kind-icon">
                    <AgentIcon agent={choice.agent} />
                  </span>
                  <span className="add-package__kind-title">{t.account.agents[choice.agent as keyof typeof t.account.agents]}</span>
                  {choice.missing && <span className="tag account-add__missing">{t.account.cliNotFound}</span>}
                  <span className="add-package__kind-hint">{gets(choice)}</span>
                </button>
              )
              return choice.missing ? (
                <Tipped key={choice.agent} className="machine-add__agent" tip={view.addNoCli(card.name)} align="start">
                  {tile}
                </Tipped>
              ) : (
                <div key={choice.agent} className="machine-add__agent">{tile}</div>
              )
            })}
          </div>
        </div>
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" onClick={onClose}>
            {t.machines.cancel}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
