import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { CheckIcon } from '../ui/icons.js'
import { FieldHead, type Inheritance } from './settingsParts.js'
import { providerName } from './settingsRun.js'
import './providerChoices.css'

/** A provider's fields stay editable regardless of which provider starts unlabelled tasks. */
export function ProviderChoices({ label, hint, className, inherit, note, columns, providers, chosen, onPick, cell }: {
  label: string
  hint: string
  className: string
  inherit?: Inheritance
  note?: ReactNode
  columns: readonly { key: string; label: string; hint: string }[]
  providers: readonly string[]
  chosen: string
  onPick: (provider: string) => void
  cell: (column: string, provider: string) => ReactNode | null
}) {
  const radios = useRef(new Map<string, HTMLButtonElement>())
  const pick = (provider: string) => {
    onPick(provider)
    radios.current.get(provider)?.focus()
  }
  const step = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': next = (at + 1) % providers.length; break
      case 'ArrowLeft':
      case 'ArrowUp': next = (at + providers.length - 1) % providers.length; break
      case 'Home': next = 0; break
      case 'End': next = providers.length - 1; break
      default: return
    }
    event.preventDefault()
    pick(providers[next]!)
  }

  return (
    <div className={className}>
      <FieldHead label={label} hint={hint} inherit={inherit} />
      {note}
      <div className="provider-choices" role="radiogroup" aria-label={label}>
        {providers.map((provider, at) => (
          <div
            key={provider}
            className={`provider-choice${provider === chosen ? ' provider-choice--chosen' : ''}`}
            onClick={(event) => {
              // Select menus and dialogs are portalled or modal, but their clicks still bubble through React's tree.
              if ((event.target as Element).closest('button, input, label, select, textarea, a, dialog, [role="option"], [role="listbox"], [contenteditable]')) return
              pick(provider)
            }}
          >
            <div className="provider-choice__head">
              <span className="provider-choice__name">{providerName(provider)}</span>
              <button
                ref={(node) => { if (node) radios.current.set(provider, node); else radios.current.delete(provider) }}
                type="button"
                className="provider-choice__radio"
                role="radio"
                aria-label={providerName(provider)}
                aria-checked={provider === chosen}
                tabIndex={provider === chosen || (!providers.includes(chosen) && at === 0) ? 0 : -1}
                onClick={() => pick(provider)}
                onKeyDown={(event) => step(event, at)}
              >
                <span className="provider-choice__mark" aria-hidden="true">{provider === chosen && <CheckIcon />}</span>
              </button>
            </div>
            <div className="provider-choice__fields">
              {columns.map((column) => {
                const control = cell(column.key, provider)
                return control === null ? null : (
                  <div key={column.key} className="provider-choice__field settings__help-scope">
                    <FieldHead label={column.label} hint={column.hint} />
                    {control}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
