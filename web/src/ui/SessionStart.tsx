import { formatClock } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import type { SessionStart, StartPhase } from '../state.js'
import './start.css'

const STEP: Record<StartPhase, number> = { launch: 0, handover: 0, boot: 1, answer: 2 }

function useElapsed(since: string): string {
  const now = useNow(1_000)
  return formatClock(now.getTime() - Date.parse(since))
}

export function StartPill({ start }: { start: SessionStart }) {
  const elapsed = useElapsed(start.since)
  return (
    <span className="start-pill" title={t.session.start.text[start.phase]}>
      <span className="start-spinner" aria-hidden="true" />
      <span role="status">{t.chain.starting[start.phase]}</span>
      <span className="start-pill__clock">{elapsed}</span>
    </span>
  )
}

export function StartCard({ start }: { start: SessionStart }) {
  const elapsed = useElapsed(start.since)
  const step = STEP[start.phase]
  return (
    <section className="start-card" aria-label={t.session.start.title[start.phase]}>
      <header className="start-card__head">
        <span className="start-spinner start-spinner--big" aria-hidden="true" />
        <h3 className="start-card__title" role="status">
          {t.session.start.title[start.phase]}
        </h3>
        <span className="start-card__clock">{elapsed}</span>
      </header>
      <p className="start-card__text">{t.session.start.text[start.phase]}</p>
      <ol className="start-card__steps">
        {t.session.start.steps.map((label, index) => (
          <li
            key={label}
            className={`start-card__step start-card__step--${index < step ? 'done' : index === step ? 'now' : 'ahead'}`}
            aria-current={index === step ? 'step' : undefined}
          >
            {label}
          </li>
        ))}
      </ol>
      <div className="start-card__bones" aria-hidden="true">
        <span className="start-card__bone" />
        <span className="start-card__bone" />
        <span className="start-card__bone" />
        <span className="start-card__bone start-card__bone--wide" />
        <span className="start-card__bone start-card__bone--wide start-card__bone--tall" />
      </div>
    </section>
  )
}
