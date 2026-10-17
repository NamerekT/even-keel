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
  /** The reply can go: the last question's button submits the form. */
  ready: boolean
  onPick: (index: number, pick: Pick) => void
}

/**
 * The open `AskUserQuestion` as one card: a question at a time with arrows between them, radios or checkboxes, "Other"
 * with its field, the preview beside; Skip and Next, Submit on the last question.
 */
export function AskPanel({ ask, picks, disabled, ready, onPick }: PanelProps) {
  const [tab, setTab] = useState(0)
  const [pointed, setPointed] = useState<string | null>(null)
  const count = ask.questions.length
  const index = Math.min(tab, count - 1)
  const last = index === count - 1
  const question = ask.questions[index]!
  const pick = picks[index] ?? NO_PICK
  const name = `ask-${ask.id}-${index}`
  const shown = question.options.find((option) => option.label === pointed) ?? question.options.find((option) => pick.labels.includes(option.label))
  const preview = (shown ?? question.options.find((option) => option.preview !== undefined))?.preview

  const choose = (label: string, on: boolean) => {
    if (!question.multiSelect) onPick(index, { labels: [label], other: null })
    else onPick(index, { ...pick, labels: on ? [...pick.labels, label] : pick.labels.filter((each) => each !== label) })
  }
  const toggleOther = (on: boolean) =>
    onPick(index, question.multiSelect ? { ...pick, other: on ? (pick.other ?? '') : null } : { labels: [], other: on ? (pick.other ?? '') : null })
  const advance = (form: HTMLFormElement | null) => {
    if (!last) setTab(index + 1)
    else if (ready) form?.requestSubmit()
  }

  return (
    <fieldset
      className="ask"
      disabled={disabled}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
        event.preventDefault()
        event.stopPropagation()
        advance(event.currentTarget.form)
      }}
    >
      <legend className="ask__head">
        <span className="ask__question">{question.question}</span>
        {count > 1 && (
          <span className="ask__pager">
            <button type="button" className="ask__step" aria-label={t.session.chat.previous} disabled={index === 0} onClick={() => setTab(index - 1)}>
              ‹
            </button>
            {t.session.chat.of(index + 1, count)}
            <button type="button" className="ask__step" aria-label={t.session.chat.nextQuestion} disabled={last} onClick={() => setTab(index + 1)}>
              ›
            </button>
          </span>
        )}
      </legend>
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
      <div className="ask__actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            onPick(index, NO_PICK)
            if (!last) setTab(index + 1)
          }}
        >
          {t.session.chat.skip}
        </button>
        <button type="button" className="button button--primary" disabled={last && !ready} onClick={(event) => advance(event.currentTarget.form)}>
          {last ? t.session.chat.submit : t.session.chat.next}
          <kbd className="ask__keys">Ctrl ↵</kbd>
        </button>
      </div>
    </fieldset>
  )
}

/** An answer as the user gave it: the "Other" text first, then the options it chose. */
function shownAnswer(question: AskQuestion, answer: string): string {
  const parts = [otherAnswer(question, answer), ...chosenLabels(question, answer)].filter((part) => part !== '')
  return parts.length === 0 ? answer : joinLabels(parts)
}

/**
 * The answers of one `AskUserQuestion` call: each question in bold, its answer under it. With the call in the
 * transcript, the card opens to its options with the chosen ones marked.
 */
export function AnswerCard({ answers, ask }: { answers: AskAnswers; ask: Ask | undefined }) {
  const known = ask?.questions.filter((question) => answers[question.question] !== undefined) ?? []
  const rows =
    known.length > 0
      ? known.map((question) => ({ question: question.question, answer: shownAnswer(question, answers[question.question]!) }))
      : Object.entries(answers).map(([question, answer]) => ({ question, answer }))
  const list = rows.map((row) => (
    <span key={row.question} className="answer-card__row">
      <span className="answer-card__question">{row.question}</span>
      <span className="answer-card__answer">{row.answer}</span>
    </span>
  ))
  if (ask === undefined || known.length === 0) return <div className="answer-card">{list}</div>
  return (
    <details className="answer-card">
      <summary className="answer-card__summary">{list}</summary>
      <AskCard ask={ask} answers={answers} />
    </details>
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
