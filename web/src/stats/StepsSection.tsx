import type { StatsStep, StatsSteps, StatsStepWeek, StatsUnknownStep } from '../../../src/stats/steps.js'
import { t } from '../i18n/index.js'
import { AnswerNotice, Section, loadedData, type FoldControl, type Loaded } from './common.js'
import { formatSeconds, formatShare } from './format.js'

function buckets(): string[] {
  const { second, minute } = t.units
  return [`< 3 ${second}`, `3–10 ${second}`, `10–30 ${second}`, `30–60 ${second}`, `1–2 ${minute}`, `2–5 ${minute}`, `5–10 ${minute}`, `10+ ${minute}`]
}

const percent = (part: number, whole: number): string => formatShare(whole > 0 ? (part / whole) * 100 : null)
const shortDay = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}`

export function StepsSection({ loaded, fold }: { loaded: Loaded<StatsSteps> | null; fold: FoldControl }) {
  const steps = loadedData(loaded)
  if (steps === null) {
    return (
      <Section title={t.stats.steps.title} fold={fold} busy={loaded === null}>
        <AnswerNotice loaded={loaded} />
      </Section>
    )
  }
  if (steps.steps.length === 0 && steps.unknown.length === 0) return null
  const growth = steps.steps.flatMap((step) => step.growth.map((each) => ({ step: step.step, ...each })))

  return (
    <Section
      title={t.stats.steps.title}
      fold={fold}
      aside={
        <>
          <span className="stats-section__count">{steps.steps.length}</span>
          <span className="stats-section__note">{t.stats.steps.note(steps.tasks)}</span>
        </>
      }
    >
      {growth.length > 0 && (
        <ul className="steps-growth">
          {growth.map((each) => (
            <li key={`${each.step}|${each.week}`}>
              {t.stats.steps.grew(each.quantile)} <code>{each.step}</code>
              {t.stats.steps.grewFrom(formatSeconds(each.from), formatSeconds(each.to))}
              <span className="steps-growth__week">{t.stats.steps.week(shortDay(each.week))}</span>
            </li>
          ))}
        </ul>
      )}
      {steps.steps.length > 0 && (
        <div className="estimates__scroll">
          <table className="tasks steps">
            <thead>
              <tr>
                <th scope="col">{t.stats.steps.step}</th>
                <th scope="col" className="tasks__num">{t.stats.steps.runs}</th>
                <th scope="col" className="tasks__num">p50</th>
                <th scope="col" className="tasks__num">p90</th>
                <th scope="col" className="tasks__num">{t.common.max}</th>
                <th scope="col" className="tasks__num" title={t.stats.steps.slow(formatSeconds(steps.settings.slowSeconds))}>
                  &gt; {formatSeconds(steps.settings.slowSeconds)}
                </th>
                <th scope="col" title={buckets().join(' · ')}>
                  {t.stats.steps.spread}
                </th>
                <th scope="col" className="tasks__num" title={t.stats.steps.coldTitle}>
                  {t.stats.steps.cold}
                </th>
                <th scope="col" className="tasks__num" title={t.stats.steps.warmTitle}>
                  {t.stats.steps.warm}
                </th>
                <th scope="col" className="tasks__num" title={t.stats.steps.failedTitle}>
                  {t.stats.steps.failed}
                </th>
                <th scope="col" className="tasks__num" title={t.stats.steps.shareTitle}>
                  {t.stats.steps.share}
                </th>
                <th scope="col" title={t.stats.steps.weeklyTitle}>
                  {t.stats.steps.weekly}
                </th>
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
  const { fail, timeout, killed, unknown } = step.outcomes
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
      <td className="tasks__num" title={`${t.stats.steps.launches(step.cold.n)}, p90 ${formatSeconds(step.cold.p90)}`}>
        {formatSeconds(step.cold.p50)} <span className="steps__count">{step.cold.n}</span>
      </td>
      <td className="tasks__num" title={`${t.stats.steps.launches(step.warm.n)}, p90 ${formatSeconds(step.warm.p90)}`}>
        {formatSeconds(step.warm.p50)} <span className="steps__count">{step.warm.n}</span>
      </td>
      <td className="tasks__num" title={t.stats.steps.outcomes(fail, timeout, killed, unknown)}>
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
  const labels = buckets()
  return (
    <span className="steps-buckets" aria-label={counts.map((count, index) => `${labels[index]}: ${count}`).join(', ')}>
      {counts.map((count, index) => (
        <span key={index} className="steps-buckets__bar" title={`${labels[index]}: ${count}`}>
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
          title={`${t.stats.steps.week(shortDay(week.week))}: ${t.stats.steps.launches(week.n)}, p50 ${formatSeconds(week.p50)}, p90 ${formatSeconds(week.p90)}`}
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
      <summary>{t.stats.steps.unruled}</summary>
      <div className="estimates__scroll">
        <table className="tasks">
          <thead>
            <tr>
              <th scope="col">{t.stats.steps.command}</th>
              <th scope="col" className="tasks__num">{t.stats.steps.runs}</th>
              <th scope="col" className="tasks__num">{t.common.total}</th>
              <th scope="col" className="tasks__num">{t.common.max}</th>
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
