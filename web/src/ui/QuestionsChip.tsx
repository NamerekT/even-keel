import { t } from '../i18n/index.js'

export function QuestionsChip({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="chip chip--questions" title={t.questions.title}>
      {t.questions.count(count)}
    </span>
  )
}
