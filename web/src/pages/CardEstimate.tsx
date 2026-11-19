import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { TaskCard as Card } from '../../../src/tracker/card.js'
import { t } from '../i18n/index.js'
import { Fact, FactList } from '../ui/blocks.js'
import { CheckIcon, PencilIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { cardTimeOf, estimateMinutes } from './cardTime.js'
import { HelpTip } from './settingsParts.js'
import type { CardEditor } from './useCardEdit.js'
import './cardEstimate.css'

/**
 * The card's estimate and the agent's active time (BTN-1097). On a card the built-in tracker keeps the estimate is
 * changed in place (BTN-1288): the tile's pencil opens a small field under it; the time comes from Tally and stays as is.
 */
export function CardTimeFacts({ card, editor }: { card: Card; editor: CardEditor | null }) {
  const time = cardTimeOf(card.estimate, card.activeS) ?? (editor === null ? null : { estimate: t.components.none, time: t.components.none, over: false })
  if (time === null) return null
  return (
    <FactList className="task-card__facts">
      {editor === null ? (
        <Fact label={t.card.estimate}>
          <dd>{time.estimate}</dd>
        </Fact>
      ) : (
        <EstimateFact card={card} editor={editor} shown={time.estimate} />
      )}
      <Fact label={t.card.time} tone={time.over ? 'warn' : 'ok'}>
        <dd>
          <Tipped tip={t.card.timeTip} inline focusable>
            {time.time}
          </Tipped>
        </dd>
      </Fact>
    </FactList>
  )
}

function EstimateFact({ card, editor, shown }: { card: Card; editor: CardEditor; shown: string }) {
  const [text, setText] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const box = useRef<HTMLElement>(null)
  const open = (from: number | null | undefined) => {
    setBad(false)
    setText(from == null ? '' : String(from))
  }
  const close = () => setText(null)

  // A press anywhere else drops the change, as Escape does.
  useEffect(() => {
    if (text === null) return
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [text === null])

  const save = async () => {
    const minutes = estimateMinutes(text ?? '')
    if (minutes === undefined) return setBad(true)
    if (minutes === (card.estimate ?? null)) return close()
    if (await editor.call('query', 'builtin/estimate', { task: card.id, minutes })) close()
  }
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    } else if (event.key === 'Escape') {
      // The card closes on Escape too: only the field does.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  // The pencil and the field sit in the value: a `<dl>` group holds only its `<dt>` and `<dd>`.
  return (
    <Fact label={t.card.estimate} className={text === null ? 'card-estimate' : 'card-estimate card-estimate--open'}>
      <dd ref={box}>
        {shown}
        <button
          type="button"
          className="card-estimate__edit"
          aria-label={t.card.estimateEdit}
          aria-expanded={text !== null}
          disabled={editor.busy}
          onClick={() => (text === null ? open(card.estimate) : close())}
        >
          <PencilIcon />
        </button>
        {text !== null && (
          <span className="card-estimate__pop">
            <span className="card-estimate__row">
              <input
                className="settings__text card-estimate__input"
                autoComplete="off"
                inputMode="decimal"
                aria-label={t.card.estimateField}
                aria-invalid={bad}
                value={text}
                autoFocus
                disabled={editor.busy}
                onChange={(event) => {
                  setBad(false)
                  setText(event.target.value)
                }}
                onKeyDown={keys}
              />
              <span className="card-estimate__unit">{t.card.estimateUnit}</span>
              <HelpTip text={t.card.estimateTip} />
              <button type="button" className="button button--small card-estimate__save" aria-label={t.card.estimateSave} disabled={editor.busy} onClick={() => void save()}>
                <CheckIcon />
              </button>
            </span>
            {bad && <span className="card-estimate__bad">{t.card.estimateBad}</span>}
          </span>
        )}
      </dd>
    </Fact>
  )
}
