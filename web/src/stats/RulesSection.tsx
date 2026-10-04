import type { TrackerUrls } from '../../../src/state.js'
import { useState } from 'react'
import { RULE_PURPOSES, type RulePurpose } from '../../../src/stats/rule-imports.js'
import { type CompareQuery, type RuleKind, type RuleMark, type RuleSet, type RuleSetFile, type StatsRules } from '../../../src/stats/rules.js'
import { formatMoment } from '../format.js'
import { localized, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AnswerNotice, Section, TaskKey, loadedData, useStatsAnswer, type Loaded } from './common.js'
import { MARK_KINDS, fileLabel, markKey, markSummary, pickedSpan, purposeLabel, ruleKindLabels, setTitle, toggleChip } from './marks.js'
import { Lines, SetNote } from './MarkTip.js'
import { COMPARE_DAYS, RuleCompare } from './RuleCompare.js'
import './rules.css'

const DAY = localized((language) => new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }))
const CLOCK = localized((language) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }))

function dayLabel(at: Date, now: Date): string {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (at.toDateString() === now.toDateString()) return t.stats.rules.today
  if (at.toDateString() === yesterday.toDateString()) return t.stats.rules.yesterday
  return DAY().format(at)
}

function spanText(fromAt: string, toAt: string, now: Date): [string, string] {
  const from = new Date(fromAt)
  const to = new Date(toAt)
  if (from.toDateString() !== to.toDateString()) return [`${dayLabel(from, now)} —`, dayLabel(to, now)]
  const clock = CLOCK()
  const time = clock.format(from) === clock.format(to) ? clock.format(to) : `${clock.format(from)}–${clock.format(to)}`
  return [dayLabel(to, now), time]
}

function Chips<T extends string>({ label, options, all, on, onChange }: { label: string; options: [T, string][]; all: readonly T[]; on: T[] | null; onChange: (next: T[] | null) => void }) {
  return (
    <div className="rule-chips" role="group" aria-label={label}>
      <span className="rule-chips__label">{label}</span>
      <button type="button" className={on === null ? 'rule-chip rule-chip--on' : 'rule-chip'} aria-pressed={on === null} onClick={() => onChange(null)}>
        {t.stats.rules.all}
      </button>
      {options.map(([value, text]) => {
        const pressed = on !== null && on.includes(value)
        return (
          <button key={value} type="button" className={pressed ? 'rule-chip rule-chip--on' : 'rule-chip'} aria-pressed={pressed} onClick={() => {
              const next = on === null ? [value] : toggleChip(on, value, all)
              onChange(next !== null && next.length === 0 ? null : next)
            }}>
            {text}
          </button>
        )
      })}
    </div>
  )
}

function FileDiff({ file }: { file: RuleSetFile }) {
  const { statsRuleDiff } = useLive()
  const key = file.changes.join(',')
  const loaded = useStatsAnswer(key, () => statsRuleDiff(file.changes), false)
  const files = loadedData(loaded)
  if (files === null) return <AnswerNotice loaded={loaded} />
  if (files.length === 0) return <p className="stats-section__note">{t.stats.rules.noTexts}</p>
  return (
    <div className="rule-diff">
      {files.map((each, index) => (
        <div key={`${each.key}:${index}`} className="rule-diff__file">
          <span className="stats-section__note">
            {formatMoment(each.fromAt, new Date())} → {formatMoment(each.toAt, new Date())} · <Lines added={each.added} removed={each.removed} />
          </span>
          {each.hunks.map((hunk) => (
            <pre key={`${hunk.oldStart}:${hunk.newStart}`} className="rule-diff__hunk">
              <span className="rule-diff__at">
                @@ −{hunk.oldStart} +{hunk.newStart} @@
              </span>
              {hunk.lines.map((line, at) => (
                <span key={at} className={line.startsWith('+') ? 'rule-diff__line rule-diff__line--added' : line.startsWith('-') ? 'rule-diff__line rule-diff__line--removed' : 'rule-diff__line'}>
                  {`${line[0]} ${line.slice(1)}`}
                </span>
              ))}
            </pre>
          ))}
        </div>
      ))}
    </div>
  )
}

function MarkRow({ mark, on, now, onPick }: { mark: RuleMark; on: boolean; now: Date; onPick: (extend: boolean) => void }) {
  const summary = markSummary(mark)
  const [day, time] = spanText(mark.fromAt, mark.toAt, now)
  const why = summary.reasons.length > 0
  const details = [why ? summary.kinds : null, summary.who.join(', ')].filter((each) => each !== null && each !== '').join(' · ')
  return (
    <button type="button" className={on ? 'rule-mark rule-mark--on' : 'rule-mark'} aria-pressed={on} onClick={(event) => onPick(event.shiftKey || event.ctrlKey || event.metaKey)}>
      <span className="rule-mark__when">
        <span>{day}</span>
        <span className="rule-mark__muted">{time}</span>
      </span>
      <span className="rule-mark__body">
        <span className="rule-mark__what">{why ? summary.reasons.join(' · ') : summary.kinds}</span>
        <span className="rule-mark__muted rule-mark__who">{details}</span>
      </span>
      <span className="rule-mark__size">
        <Lines added={summary.added} removed={summary.removed} />
        <span className="rule-mark__muted">{t.stats.rules.fileCount(summary.files)}</span>
      </span>
    </button>
  )
}

function FileRow({ file, open, onToggle }: { file: RuleSetFile; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" className="rule-file" aria-expanded={open} title={file.display} onClick={onToggle}>
        <span className="rule-file__caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="rule-file__where">{file.project ?? t.stats.rules.shared}</span>
        <span className="rule-file__path">{fileLabel(file.display)}</span>
        <Lines added={file.added} removed={file.removed} />
      </button>
      {open && (file.changes.length === 0 ? <p className="stats-section__note rule-file__note">{t.stats.rules.noText}</p> : <FileDiff file={file} />)}
    </li>
  )
}

function SetView({ set, trackerUrls }: { set: RuleSet; trackerUrls: TrackerUrls }) {
  const [open, setOpen] = useState<string | null>(null)
  const title = set.task === null ? (set.title ?? setTitle(set)) : set.title !== set.task ? set.title : null
  return (
    <li className="rule-set">
      <span className="rule-set__at">{CLOCK().format(new Date(set.at))}</span>
      <div className="rule-set__body">
        <div className="rule-set__head">
          {set.task !== null && <TaskKey id={set.task} trackerUrls={trackerUrls} />}
          {title !== null && <span className={set.title === null ? 'rule-mark__muted' : undefined}>{title}</span>}
        </div>
        <SetNote set={set} />
        <ul className="rule-files">
          {set.id.startsWith('i:')
            ? (set.note?.files ?? []).map((file) => (
                <li key={file.path} className="rule-file rule-file--static" title={file.path}>
                  <span className="rule-file__caret" />
                  <span className="rule-file__where">{t.stats.rules.actions[file.action]}</span>
                  <span className="rule-file__path">{fileLabel(file.path)}</span>
                  {file.summary !== '' && <span className="rule-file__summary">{file.summary}</span>}
                </li>
              ))
            : set.files.map((file) => <FileRow key={file.key} file={file} open={open === file.key} onToggle={() => setOpen(open === file.key ? null : file.key)} />)}
        </ul>
      </div>
    </li>
  )
}

function Picked({ marks, before, after, now, trackerUrls }: { marks: RuleMark[]; before: string; after: string; now: Date; trackerUrls: TrackerUrls }) {
  const sets = marks.flatMap((mark) => mark.sets).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const days = new Map<string, RuleSet[]>()
  for (const set of sets) {
    const day = dayLabel(new Date(set.at), now)
    days.set(day, [...(days.get(day) ?? []), set])
  }
  const summary = markSummary({ fromAt: before, toAt: after, sets })
  const [day, time] = spanText(before, after, now)
  return (
    <div className="rule-card">
      <header className="rule-card__head">
        <h3 className="rule-card__title">{t.stats.rules.changed}</h3>
        <span className="stats-section__note">
          {day} {time} · {t.stats.rules.fileCount(summary.files)}
        </span>
        <Lines added={summary.added} removed={summary.removed} />
      </header>
      {[...days].map(([label, each]) => (
        <section key={label} className="rule-day">
          {days.size > 1 && <h4 className="rule-day__title">{label}</h4>}
          <ol className="rule-sets">
            {each.map((set) => (
              <SetView key={set.id} set={set} trackerUrls={trackerUrls} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function Compare({ query, days }: { query: Omit<CompareQuery, 'days'>; days: number }) {
  const { statsCompare } = useLive()
  const full = { ...query, days }
  const key = JSON.stringify(full)
  const loaded = useStatsAnswer(key, () => statsCompare(full), false)
  const compare = loadedData(loaded)
  return compare === null || loaded?.key !== key ? <AnswerNotice loaded={loaded?.key === key ? loaded : null} /> : <RuleCompare compare={compare} />
}

export function RulesSection({
  loaded,
  marks,
  kinds,
  purposes,
  onFilter,
  picked,
  onPick,
  base,
  trackerUrls,
}: {
  loaded: Loaded<StatsRules> | null
  marks: RuleMark[]
  kinds: RuleKind[] | null
  purposes: RulePurpose[] | null
  onFilter: (next: { kinds?: RuleKind[] | null; purposes?: RulePurpose[] | null }) => void
  picked: string[]
  onPick: (key: string, extend: boolean) => void
  base: Omit<CompareQuery, 'before' | 'after' | 'days'>
  trackerUrls: TrackerUrls
}) {
  const [days, setDays] = useState<number | null>(null)
  const rules = loadedData(loaded)
  const span = pickedSpan(marks, picked)
  const now = new Date()
  return (
    <Section title={t.stats.rules.title} aside={<span className="stats-section__note">{t.stats.rules.note}</span>}>
      <div className="rule-filters">
        <Chips label={t.stats.rules.files} options={ruleKindLabels()} all={MARK_KINDS} on={kinds} onChange={(next) => onFilter({ kinds: next })} />
        <Chips
          label={t.stats.rules.purpose}
          options={RULE_PURPOSES.map((purpose) => [purpose, purposeLabel(purpose)])}
          all={RULE_PURPOSES}
          on={purposes}
          onChange={(next) => onFilter({ purposes: next })}
        />
      </div>
      {rules === null ? (
        <AnswerNotice loaded={loaded} />
      ) : marks.length === 0 ? (
        <p className="stats-section__note">{t.stats.rules.none}</p>
      ) : (
        <>
          <ol className="rule-marks">
            {marks.map((mark) => {
              const key = markKey(mark)
              return (
                <li key={key}>
                  <MarkRow mark={mark} on={picked.includes(key)} now={now} onPick={(extend) => onPick(key, extend)} />
                </li>
              )
            })}
          </ol>
          {span === null ? (
            <p className="rule-hint">{t.stats.rules.pick}</p>
          ) : (
            <>
              <Picked marks={span.marks} before={span.before} after={span.after} now={now} trackerUrls={trackerUrls} />
              <div className="rule-card">
                <header className="rule-card__head">
                  <h3 className="rule-card__title">{t.stats.rules.compare}</h3>
                  <div className="segmented" role="group" aria-label={t.stats.rules.days}>
                    {COMPARE_DAYS.map((each) => {
                      const current = days ?? rules.compare.days
                      return (
                        <button key={each} type="button" className={each === current ? 'segmented__item segmented__item--on' : 'segmented__item'} aria-pressed={each === current} onClick={() => setDays(each)}>
                          {t.stats.rules.dayCount(each)}
                        </button>
                      )
                    })}
                  </div>
                  <span className="stats-section__note">{t.stats.rules.eachSide}</span>
                </header>
                <Compare query={{ ...base, before: span.before, after: span.after }} days={days ?? rules.compare.days} />
              </div>
            </>
          )}
        </>
      )}
      <p className="stats-section__note rule-coverage">{t.stats.rules.coverage}</p>
    </Section>
  )
}
