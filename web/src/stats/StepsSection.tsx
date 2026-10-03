import type { StatsStep, StatsSteps, StatsStepWeek, StatsUnknownStep } from '../../../src/stats/steps.js'
import { plural } from '../format.js'
import { AnswerNotice, Section, loadedData, type Loaded } from './common.js'
import { formatSeconds, formatShare } from './format.js'

const BUCKETS = ['< 3 с', '3–10 с', '10–30 с', '30–60 с', '1–2 мин', '2–5 мин', '5–10 мин', '10+ мин']

const percent = (part: number, whole: number): string => formatShare(whole > 0 ? (part / whole) * 100 : null)
const shortDay = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}`

export function StepsSection({ loaded }: { loaded: Loaded<StatsSteps> | null }) {
  const steps = loadedData(loaded)
  if (steps === null) {
    return (
      <Section title="Шаги">
        <AnswerNotice loaded={loaded} />
      </Section>
    )
  }
  if (steps.steps.length === 0 && steps.unknown.length === 0) return null
  const growth = steps.steps.flatMap((step) => step.growth.map((each) => ({ step: step.step, ...each })))

  return (
    <Section
      title="Шаги"
      aside={
        <span className="stats-section__note">
          сборки, проверки и тесты по командам; фоновый запуск — до уведомления о конце; доля — от активного времени {steps.tasks}{' '}
          {plural(steps.tasks, 'задачи', 'задач', 'задач')} за всю задачу
        </span>
      }
    >
      {growth.length > 0 && (
        <ul className="steps-growth">
          {growth.map((each) => (
            <li key={`${each.step}|${each.week}`}>
              {each.quantile} <code>{each.step}</code> вырос с {formatSeconds(each.from)} до {formatSeconds(each.to)}{' '}
              <span className="steps-growth__week">неделя с {shortDay(each.week)}</span>
            </li>
          ))}
        </ul>
      )}
      {steps.steps.length > 0 && (
        <div className="estimates__scroll">
          <table className="tasks steps">
            <thead>
              <tr>
                <th scope="col">Шаг</th>
                <th scope="col" className="tasks__num">Запуски</th>
                <th scope="col" className="tasks__num">p50</th>
                <th scope="col" className="tasks__num">p90</th>
                <th scope="col" className="tasks__num">Макс.</th>
                <th scope="col" className="tasks__num" title={`Доля запусков дольше ${formatSeconds(steps.settings.slowSeconds)}`}>
                  &gt; {formatSeconds(steps.settings.slowSeconds)}
                </th>
                <th scope="col" title={BUCKETS.join(' · ')}>Распределение</th>
                <th scope="col" className="tasks__num" title="Первый запуск шага в worktree или слоте на этой ветке: p50 и число">
                  Холодный
                </th>
                <th scope="col" className="tasks__num" title="Повторные запуски: p50 и число">
                  Тёплый
                </th>
                <th scope="col" className="tasks__num" title="Падение или таймаут">
                  Упало
                </th>
                <th scope="col" className="tasks__num" title="Доля активного времени задач, ушедшая на шаг">
                  Время задач
                </th>
                <th scope="col" title="p90 по неделям">По неделям</th>
              </tr>
            </thead>
            <tbody>
              {steps.steps.map((step) => (
                <StepRow key={step.step} step={step} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {steps.unknown.length > 0 && <UnknownSteps unknown={steps.unknown} />}
    </Section>
  )
}

function StepRow({ step }: { step: StatsStep }) {
  const failed = step.outcomes.fail + step.outcomes.timeout
  return (
    <tr>
      <th scope="row">
        <code>{step.step}</code>
      </th>
      <td className="tasks__num">{step.n}</td>
      <td className="tasks__num">{formatSeconds(step.p50)}</td>
      <td className="tasks__num">{formatSeconds(step.p90)}</td>
      <td className="tasks__num">{formatSeconds(step.max)}</td>
      <td className="tasks__num">{formatShare(step.slow * 100)}</td>
      <td>
        <Buckets counts={step.buckets} />
      </td>
      <td className="tasks__num" title={`${step.cold.n} ${plural(step.cold.n, 'запуск', 'запуска', 'запусков')}, p90 ${formatSeconds(step.cold.p90)}`}>
        {formatSeconds(step.cold.p50)} <span className="steps__count">{step.cold.n}</span>
      </td>
      <td className="tasks__num" title={`${step.warm.n} ${plural(step.warm.n, 'запуск', 'запуска', 'запусков')}, p90 ${formatSeconds(step.warm.p90)}`}>
        {formatSeconds(step.warm.p50)} <span className="steps__count">{step.warm.n}</span>
      </td>
      <td
        className="tasks__num"
        title={`упало ${step.outcomes.fail}, таймаут ${step.outcomes.timeout}, прервано ${step.outcomes.killed}, неизвестно ${step.outcomes.unknown}`}
      >
        {percent(failed, step.n)}
      </td>
      <td className="tasks__num">{step.share === null ? '—' : formatShare(step.share * 100)}</td>
      <td>
        <Weeks weeks={step.weeks} />
      </td>
    </tr>
  )
}

function Buckets({ counts }: { counts: number[] }) {
  const top = Math.max(1, ...counts)
  return (
    <span className="steps-buckets" aria-label={counts.map((count, index) => `${BUCKETS[index]}: ${count}`).join(', ')}>
      {counts.map((count, index) => (
        <span key={BUCKETS[index]} className="steps-buckets__bar" title={`${BUCKETS[index]}: ${count}`}>
          <span style={{ height: `${count === 0 ? 0 : Math.max(8, (count / top) * 100)}%` }} />
        </span>
      ))}
    </span>
  )
}

function Weeks({ weeks }: { weeks: StatsStepWeek[] }) {
  const shown = weeks.slice(-8)
  const top = Math.max(1, ...shown.map((week) => week.p90))
  return (
    <span className="steps-buckets steps-weeks">
      {shown.map((week) => (
        <span
          key={week.week}
          className={`steps-buckets__bar${week.grewP50 || week.grewP90 ? ' steps-weeks__grew' : ''}`}
          title={`неделя с ${shortDay(week.week)}: ${week.n} ${plural(week.n, 'запуск', 'запуска', 'запусков')}, p50 ${formatSeconds(week.p50)}, p90 ${formatSeconds(week.p90)}`}
        >
          <span style={{ height: `${Math.max(8, (week.p90 / top) * 100)}%` }} />
        </span>
      ))}
    </span>
  )
}

function UnknownSteps({ unknown }: { unknown: StatsUnknownStep[] }) {
  return (
    <details className="steps-unknown">
      <summary>Команды без правила — дольше всего в сумме</summary>
      <div className="estimates__scroll">
        <table className="tasks">
          <thead>
            <tr>
              <th scope="col">Команда</th>
              <th scope="col" className="tasks__num">Запуски</th>
              <th scope="col" className="tasks__num">Всего</th>
              <th scope="col" className="tasks__num">Макс.</th>
            </tr>
          </thead>
          <tbody>
            {unknown.map((each) => (
              <tr key={each.signature}>
                <td title={each.command}>
                  <code>{each.signature}</code>
                </td>
                <td className="tasks__num">{each.n}</td>
                <td className="tasks__num">{formatSeconds(each.seconds)}</td>
                <td className="tasks__num">{formatSeconds(each.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
