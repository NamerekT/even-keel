import type { TrackerUrls } from '../../../src/state.js'
import { useEffect, useState, type ReactNode } from 'react'
import type { StatsAnswer } from '../../../src/stats/model.js'
import { issueLink } from '../state.js'

const REFRESH_MS = 5 * 60_000

export type Loaded<T> = { key: string; answer: StatsAnswer<T> } | { key: string; failure: string }

export function useStatsAnswer<T>(key: string | null, load: () => Promise<StatsAnswer<T>>, refresh = true): Loaded<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)

  useEffect(() => {
    if (key === null) return
    let alive = true
    const run = () =>
      load().then(
        (answer) => alive && setLoaded({ key, answer }),
        (reason: unknown) => alive && setLoaded({ key, failure: reason instanceof Error ? reason.message : String(reason) }),
      )
    void run()
    const timer = refresh ? setInterval(() => void run(), REFRESH_MS) : undefined
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [key])

  return loaded
}

export function loadedData<T>(loaded: Loaded<T> | null): T | null {
  return loaded !== null && 'answer' in loaded && loaded.answer.state === 'ok' ? loaded.answer.data : null
}

export function AnswerNotice({ loaded }: { loaded: Loaded<unknown> | null }) {
  if (loaded === null) return <p className="placeholder">Читаю статистику…</p>
  if ('failure' in loaded) return <p className="notice notice--error">Батон не ответил: {loaded.failure}</p>
  if (loaded.answer.state === 'off') return <p className="notice notice--warn">Статистика Tally выключена: {loaded.answer.reason}.</p>
  if (loaded.answer.state === 'error') return <p className="notice notice--error">База Tally недоступна: {loaded.answer.error}</p>
  return null
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: [T, string, string?][]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([option, text, title]) => (
        <button
          key={option}
          type="button"
          title={title}
          className={option === value ? 'segmented__item segmented__item--on' : 'segmented__item'}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function TaskKey({ id, trackerUrls }: { id: string; trackerUrls: TrackerUrls }) {
  const link = issueLink(trackerUrls, id)
  return link === null ? (
    <span className="stats__key">{id}</span>
  ) : (
    <a className="stats__key" href={link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
      {id}
    </a>
  )
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="stats-section">
      <header className="stats-section__head">
        <h2 className="stats-section__title">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}
