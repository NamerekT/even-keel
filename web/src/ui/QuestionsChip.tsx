import { useState } from 'react'
import { Link } from 'react-router'
import { t } from '../i18n/index.js'
import { QuestionIcon } from './icons.js'

/** With `to` the chip is a link to the session of the first question. */
export function QuestionsChip({ count, to = null }: { count: number; to?: string | null }) {
  const [seen, setSeen] = useState(count)
  const [grown, setGrown] = useState(0)
  if (count !== seen) {
    setSeen(count)
    if (count > seen) setGrown(grown + 1)
  }

  if (count === 0) return null
  const className = grown > 0 ? 'chip chip--questions chip--grown' : 'chip chip--questions'
  const title = `${t.questions.count(count)}. ${t.questions.title}`
  const body = (
    <>
      <QuestionIcon />
      {count}
    </>
  )
  return to === null ? (
    <span key={grown} className={className} role="img" aria-label={t.questions.count(count)} title={title}>
      {body}
    </span>
  ) : (
    <Link key={grown} to={to} className={`${className} chip--link`} aria-label={t.questions.count(count)} title={title}>
      {body}
    </Link>
  )
}
