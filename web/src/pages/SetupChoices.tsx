import type { SharedForm } from '../../../src/state.js'
import { CheckIcon } from '../ui/icons.js'

/** A setup step's write: the shared settings with the change, at once. */
export type Save = (change: Partial<SharedForm>) => Promise<boolean>

interface Choice<T extends string> {
  id: T
  title: string
  hint?: string
}

/** Choice cards as buttons: the value in force pressed, with a check in its corner; a press writes another one. */
export function Cards<T extends string>({ items, chosen, disabled, onPick }: { items: Choice<T>[]; chosen: string; disabled: boolean; onPick: (value: T) => void }) {
  return (
    <ul className="add-choices setup__cards">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="add-choice setup-choice" aria-pressed={item.id === chosen} disabled={disabled} onClick={() => onPick(item.id)}>
            <span className="add-choice__title">{item.title}</span>
            {item.hint !== undefined && <span className="add-choice__hint">{item.hint}</span>}
            {item.id === chosen && <ChosenMark />}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The check in the corner of the card picked. */
export function ChosenMark() {
  return (
    <span className="setup-choice__mark" aria-hidden="true">
      <CheckIcon />
    </span>
  )
}
