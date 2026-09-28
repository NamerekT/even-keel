import { plural } from '../format.js'

export function QuestionsChip({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="chip chip--questions" title="Задачи с ярлыком «Вопрос» ждут ответа в описании — без него сессия, скорее всего, встанет">
      {count} {plural(count, 'вопрос', 'вопроса', 'вопросов')}
    </span>
  )
}
