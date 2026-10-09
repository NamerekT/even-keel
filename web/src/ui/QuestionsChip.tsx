import { useState } from 'react'
import { t } from '../i18n/index.js'
import { QuestionIcon } from './icons.js'

export function QuestionsChip({ count }: { count: number }) {
  const [seen, setSeen] = useState(count)
  const [grown, setGrown] = useState(0)
  if (count !== seen) {
    setSeen(count)
    if (count > seen) setGrown(grown + 1)
  }

  if (count === 0) return null
  return (
    <span
      key={grown}
      className={grown > 0 ? 'chip chip--questions chip--grown' : 'chip chip--questions'}
      role="img"
      aria-label={t.questions.count(count)}
      title={`${t.questions.count(count)}. ${t.questions.title}`}
    >
      <QuestionIcon />
      {count}
    </span>
  )
}
