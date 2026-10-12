import { useState } from 'react'
import { chosenLabels, joinLabels, otherAnswer, type Ask, type AskAnswers, type AskQuestion } from '../../../src/sessions/ask.js'
import { t } from '../i18n/index.js'
import './ask.css'

/** What the user has picked for one question: option labels and, when "Other" is on, its text. */
export interface Pick {
  labels: string[]
  other: string | null
}

export const NO_PICK: Pick = { labels: [], other: null }

/** The answer the CLI would record for a pick: one label, the "Other" text, or the labels joined for a multi-select. */
export function pickAnswer(question: AskQuestion, pick: Pick): string {
  const other = pick.other?.trim() ?? ''
  if (!question.multiSelect) return other !== '' ? other : (pick.labels[0] ?? '')
  return joinLabels(other === '' ? pick.labels : [...pick.labels, other])
}

export function askAnswers(ask: Ask, picks: Pick[]): AskAnswers {
  return Object.fromEntries(ask.questions.map((question, index) => [question.question, pickAnswer(question, picks[index] ?? NO_PICK)]))
}

interface PanelProps {
  ask: Ask
  picks: Pick[]
  disabled: boolean
  onPick: (index: number, pick: Pick) => void
}

/** The options of an `AskUserQuestion` to choose from: a tab per question, radios or checkboxes, "Other", the preview beside. */
export function AskPanel({ ask, picks, disabled, onPick }: PanelProps) {
  const [tab, setTab] = useState(0)
  const [pointed, setPointed] = useState<string | null>(null)
  const index = Math.min(tab, ask.questions.length - 1)
  const question = ask.questions[index]!
  const pick = picks[index] ?? NO_PICK
  const name = `ask-${ask.id}-${index}`
  const shown = question.options.find((option) => option.label === pointed) ?? question.options.find((option) => pick.labels.includes(option.label))
  const preview = (shown ?? question.options.find((option) => option.preview !== undefined))?.preview

  const choose = (label: string, on: boolean) => {
    if (!question.multiSelect) {
      onPick(index, { labels: [label], other: null })
      if (index < ask.questions.length - 1) setTab(index + 1)
      return
    }
    onPick(index, { ...pick, labels: on ? [...pick.labels, label] : pick.labels.filter((each) => each !== label) })
  }
  const toggleOther = (on: boolean) =>
    onPick(index, question.multiSelect ? { ...pick, other: on ? (pick.other ?? '') : null } : { labels: [], other: on ? (pick.other ?? '') : null })

  return (
    <fieldset className="ask" disabled={disabled}>
      {ask.questions.length > 1 && (
        <div className="ask__tabs" role="tablist">
          {ask.questions.map((each, at) => (
            <button
              key={at}
              type="button"
              role="tab"
              aria-selected={at === index}
              className={`ask__tab${pickAnswer(each, picks[at] ?? NO_PICK) !== '' ? ' ask__tab--done' : ''}`}
              onClick={() => setTab(at)}
            >
              {each.header || at + 1}
            </button>
          ))}
        </div>
      )}
      <legend className="ask__question">{question.question}</legend>
      <div className={`ask__body${preview === undefined ? '' : ' ask__body--preview'}`}>
        <ul className="ask__options">
          {question.options.map((option) => (
            <li key={option.label} onMouseEnter={() => setPointed(option.label)} onMouseLeave={() => setPointed(null)}>
              <label className="ask__option">
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={name}
                  checked={pick.labels.includes(option.label)}
                  onChange={(event) => choose(option.label, event.target.checked)}
                  onFocus={() => setPointed(option.label)}
                />
                <span className="ask__label">{option.label}</span>
                {option.description !== '' && <span className="ask__description">{option.description}</span>}
              </label>
            </li>
          ))}
          <li>
            <label className="ask__option">
              <input type={question.multiSelect ? 'checkbox' : 'radio'} name={name} checked={pick.other !== null} onChange={(event) => toggleOther(event.target.checked)} />
              <span className="ask__label">{t.session.chat.other}</span>
            </label>
            {pick.other !== null && (
              <input
                className="ask__other"
                type="text"
                value={pick.other}
                placeholder={t.session.chat.otherPlaceholder}
                autoFocus
                onChange={(event) => onPick(index, { ...pick, other: event.target.value })}
              />
            )}
          </li>
        </ul>
        {preview !== undefined && <pre className="ask__preview">{preview}</pre>}
      </div>
    </fieldset>
  )
}

/** An `AskUserQuestion` in the transcript: once answered, the chosen options are marked and the rest dimmed. */
export function AskCard({ ask, answers }: { ask: Ask; answers: AskAnswers | null }) {
  return (
    <div className={`ask-card${answers === null ? ' ask-card--open' : ''}`}>
      {ask.questions.map((question) => {
        const answer = answers?.[question.question]
        const chosen = chosenLabels(question, answer)
        const other = otherAnswer(question, answer) || null
        return (
          <section key={question.question} className="ask-card__question">
            <h4 className="ask-card__head">
              <span className="ask-card__header">{question.header}</span>
              {question.question}
              {answers === null && <span className="ask-card__pending">{t.session.chat.pending}</span>}
            </h4>
            <ul className="ask-card__options">
              {question.options.map((option) => {
                const state = answers === null ? '' : chosen.includes(option.label) ? ' ask-card__option--chosen' : ' ask-card__option--dim'
                return (
                  <li key={option.label} className={`ask-card__option${state}`}>
                    <span className="ask-card__mark" aria-hidden="true">
                      {state.includes('chosen') ? '✓' : '·'}
                    </span>
                    <span className="ask__label">{option.label}</span>
                    {option.description !== '' && <span className="ask__description">{option.description}</span>}
                  </li>
                )
              })}
              {other !== null && (
                <li className="ask-card__option ask-card__option--chosen">
                  <span className="ask-card__mark" aria-hidden="true">
                    ✓
                  </span>
                  <span className="ask__label">
                    {t.session.chat.other}: {other}
                  </span>
                </li>
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
