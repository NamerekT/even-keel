import { useEffect, useId, useRef } from 'react'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Segmented } from '../stats/common.js'
import '../tools/addPackage.css'
import { SectionLabel } from '../ui/blocks.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { CloseIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { chatPackageGroups, goneChoices, withChoice, type ChatPackageRow, type OwnChoice, type OwnPackages } from './chatPackages.js'
import './chatExtras.css'

interface Props {
  project: string
  own: OwnPackages
  onChange: (own: OwnPackages) => void
  onClose: () => void
}

/**
 * The "More" window over a new chat's (BTN-1696): the project's packages, each as the level above has it or on or off
 * for this chat alone, with what the chat gets and where that comes from. A change applies to the new chat's window at once.
 */
export function ChatExtrasDialog({ project, own, onChange, onClose }: Props) {
  const { state } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const text = t.chats.extras
  const view = state?.packages
  const groups = view === undefined ? [] : chatPackageGroups(view, project, own).filter((group) => group.rows.length > 0)
  const gone = view === undefined ? [] : goneChoices(view, project, own)

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const pick = (name: string, choice: OwnChoice) => onChange(withChoice(own, name, choice))

  return (
    <dialog
      ref={dialog}
      className="add-package chat-extras"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onClick={(event) => event.stopPropagation()}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {text.title}
          </h2>
          <button type="button" className="panel__close" aria-label={text.done} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="add-package__body">
          <SectionLabel>{text.packages}</SectionLabel>
          <p className="add-package__lead">{text.lead}</p>
          {groups.length === 0 && gone.length === 0 && <p className="add-package__empty">{text.none}</p>}
          {groups.map((group) => (
            <section key={`${group.kind}:${group.marketplace ?? ''}`} className="chat-extras__group">
              <h3 className="chat-extras__head">{group.kind === 'own' ? t.packages.group.own : group.kind === 'mcp' ? t.packages.group.mcp : group.marketplace}</h3>
              {group.rows.map((row) => (
                <PackageRow key={row.name} row={row} onPick={(choice) => pick(row.name, choice)} />
              ))}
            </section>
          ))}
          {gone.map((each) => (
            <div key={each.name} className="chat-extras__row">
              <span className="chat-extras__name">
                <span className="chat-extras__label">{each.name}</span>
                <span className="chat-extras__gone">{text.gone}</span>
              </span>
              <button type="button" className="button button--small" onClick={() => pick(each.name, 'inherit')}>
                {text.reset}
              </button>
            </div>
          ))}
        </div>
        <footer className="add-package__foot chat-extras__foot">
          <button type="button" className="button button--primary" onClick={onClose}>
            {text.done}
          </button>
        </footer>
      </div>
    </dialog>
  )
}

function PackageRow({ row, onPick }: { row: ChatPackageRow; onPick: (choice: OwnChoice) => void }) {
  const text = t.chats.extras
  const state = row.source === 'builtIn' ? text.builtIn : text.state(row.enabled, row.source)
  return (
    <div className="chat-extras__row">
      <span className="chat-extras__name">
        <span className="chat-extras__label">{row.label}</span>
        {row.source === 'chat' ? (
          <Tipped inline tip={text.above(row.above.enabled, row.above.source)}>
            <span className="chat-extras__state chat-extras__state--own">{state}</span>
          </Tipped>
        ) : (
          <span className="chat-extras__state">{state}</span>
        )}
      </span>
      {!row.builtIn && (
        <Segmented<OwnChoice>
          label={row.label}
          options={[
            ['inherit', text.inherit],
            ['on', text.on],
            ['off', text.off],
          ]}
          value={row.own}
          onChange={onPick}
        />
      )}
    </div>
  )
}
