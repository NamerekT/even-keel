import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { CheckIcon, CloseIcon } from '../ui/icons.js'
import { secretInput } from '../ui/secret.js'
import { AgentIcon } from './accountParts.js'
import '../tools/addPackage.css'
import './accountAdd.css'

/** The agents an API key on a machine is for, in the order of the hub's add dialog. */
export const MACHINE_KEY_AGENTS = ['claude', 'codex', 'opencode'] as const

interface Props {
  machine: { id: string; name: string }
  /** The agents to pick from; one — no pick. */
  agents: readonly string[]
  /** The machine's folder the key is for (its signed-out row): no name, the hub puts the key in place or makes a folder of its name. */
  folder?: string
  busy: boolean
  onAdded: () => void
  back?: () => void
  /** One more button of the footer, at its left (the folder's removal). */
  extra?: ReactNode
}

const gets = (agent: string): string => (t.machinePanel.view.keyGets as Record<string, string>)[agent] ?? ''

/**
 * An API key for a machine elsewhere (BTN-1684): `machines/key` sends it to the machine, which checks it with the
 * provider and keeps it in its own folder; the refusal shows under the field.
 */
export function MachineKeyForm({ machine, agents, folder, busy, onAdded, back, extra }: Props) {
  const view = t.machinePanel.view
  const group = useId()
  const keyId = useId()
  const nameId = useId()
  const { send, sending, failure } = useCommand()
  const [agent, setAgent] = useState(agents[0] ?? 'claude')
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const working = busy || sending
  const ready = !working && key.trim() !== ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    if (await send('machines/key', { machine: machine.id, agent, key, name, ...(folder !== undefined && { folder }) })) onAdded()
  }

  return (
    <form className="add-package__form" onSubmit={(event) => void submit(event)}>
      <div className="add-package__body">
        <p className="add-package__lead">{folder === undefined ? view.keyLead(machine.name) : view.keyFolderLead(machine.name)}</p>
        {agents.length > 1 && (
          <fieldset className="add-package__field">
            <legend className="add-package__label add-package__legend">{view.keyAgent}</legend>
            <div className="account-add__ways">
              {agents.map((each) => (
                <label key={each} className="account-add__way">
                  <input type="radio" name={group} value={each} checked={each === agent} onChange={() => setAgent(each)} />
                  <span className="account-add__way-icon"><AgentIcon agent={each} /></span>
                  <span className="account-add__way-title">{t.account.agents[each as keyof typeof t.account.agents]}</span>
                  <span className="account-add__way-check"><CheckIcon /></span>
                  <span className="account-add__way-gets">{gets(each)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="add-package__field">
          <label className="add-package__label" htmlFor={keyId}>{agents.length > 1 ? t.addAccount.key.key : gets(agent) || t.addAccount.key.key}</label>
          <FieldStrip line={failure === null ? null : { tone: 'error', text: say(failure) }} fold wide>
            <input
              className="add-package__input add-package__input--mono"
              {...secretInput()}
              id={keyId}
              value={key}
              aria-invalid={failure !== null}
              onChange={(event) => setKey(event.target.value)}
              autoFocus
            />
          </FieldStrip>
        </div>
        {folder === undefined && (
          <div className="add-package__field">
            <label className="add-package__label" htmlFor={nameId}>{t.addAccount.name}</label>
            <input className="add-package__input" id={nameId} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" spellCheck={false} />
          </div>
        )}
      </div>
      <footer className="add-package__foot">
        {back !== undefined && (
          <button type="button" className="button" disabled={working} onClick={back}>
            ← {t.account.back}
          </button>
        )}
        {extra}
        <span className="add-package__spacer" />
        <button type="submit" className="button button--primary" disabled={!ready}>
          {folder === undefined ? view.keyAdd : view.keySave}
        </button>
      </footer>
    </form>
  )
}

/** The key form of a machine's signed-out folder in a window of its own (its row's "Enter key", the way dialog's "API key"). */
export function MachineKeyDialog({ machine, agent, folder, busy, onClose, extra }: {
  machine: { id: string; name: string }
  agent: string
  folder: string
  busy: boolean
  onClose: () => void
  extra?: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])
  return (
    <dialog ref={dialog} className="add-package add-package--narrow" aria-labelledby={heading} {...backdrop}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}>
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">{t.machinePanel.view.keyFolderTitle(folder, machine.name)}</h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <MachineKeyForm machine={machine} agents={[agent]} folder={folder} busy={busy} onAdded={onClose} extra={extra} />
      </div>
    </dialog>
  )
}
