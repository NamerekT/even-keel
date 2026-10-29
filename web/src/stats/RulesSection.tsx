import { Fold } from '../ui/Fold.js'
import type { TrackerUrls } from '../../../src/state.js'
import { useState, type ReactNode } from 'react'
import { RULE_PLACES, RULE_PURPOSES, type RulePlace, type RulePurpose } from '../../../src/stats/rule-imports.js'
import { type CompareQuery, type RuleKind, type RuleMark, type RuleSet, type RuleSetFile, type StatsRules } from '../../../src/stats/rules.js'
import { formatMoment } from '../format.js'
import { localized, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AnswerNotice, Section, TaskKey, loadedData, useStatsAnswer, type FoldControl, type Loaded } from './common.js'
import { seriesStyle } from '../ui/series.js'
import { MARK_KINDS, fileLabel, kindText, markKey, markSummary, pickedSpan, purposeLabel, ruleKindLabels, setTitle, toggleChip, type KindCount } from './marks.js'
import { Lines, SetNote } from './MarkTip.js'
import { ComparePanel } from './ComparePanel.js'
import { addDays, type DayRange } from './period.js'
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

type Colors = Map<string, number | null>

function PlaceDot({ project, colors }: { project: string | null; colors: Colors }) {
  return project === null ? (
    <span className="rule-dot rule-dot--shared" aria-hidden="true" />
  ) : (
    <span className="rule-dot" style={seriesStyle(colors.get(project) ?? null)} aria-hidden="true" />
  )
}

function KindList({ kinds, colors }: { kinds: KindCount[]; colors: Colors }) {
  return kinds.map((each) => (
    <span key={`${each.project ?? ''}:${each.kind}`} className="rule-kind" title={each.project ?? t.stats.rules.places.shared}>
      <PlaceDot project={each.project} colors={colors} />
      {kindText(each)}
    </span>
  ))
}

// Shared files and project files: the legend of the dots in the list, and a filter — a click keeps only that place.
function PlaceLegend({ on, projects, colors, onChange }: { on: RulePlace[] | null; projects: string[]; colors: Colors; onChange: (next: RulePlace[] | null) => void }) {
  const item = (place: RulePlace, dots: ReactNode, label: string) => {
    const shown = on === null || on.includes(place)
    return (
      <button
        type="button"
        className={shown ? 'rule-legend__item' : 'rule-legend__item rule-legend__item--off'}
        aria-pressed={on !== null && on.includes(place)}
        onClick={() => {
          const next = on === null ? [place] : toggleChip(on, place, RULE_PLACES)
          onChange(next !== null && next.length === 0 ? null : next)
        }}>
        {dots}
        {label}
      </button>
    )
  }
  return (
    <div className="rule-legend" role="group" aria-label={t.stats.rules.places.label}>
      {item('shared', <PlaceDot project={null} colors={colors} />, t.stats.rules.places.shared)}
      {item(
        'project',
        <span className="rule-legend__dots">
          {projects.slice(0, 4).map((project) => (
            <PlaceDot key={project} project={project} colors={colors} />
          ))}
        </span>,
        projects.length === 1 ? projects[0]! : t.stats.rules.places.project,
      )}
    </div>
  )
}

function MarkRow({ mark, on, now, colors, onPick }: { mark: RuleMark; on: boolean; now: Date; colors: Colors; onPick: (extend: boolean) => void }) {
  const summary = markSummary(mark)
  const [day, time] = spanText(mark.fromAt, mark.toAt, now)
  const why = summary.reasons.length > 0
  const who = summary.who.join(', ')
  return (
    <button type="button" className={on ? 'rule-mark rule-mark--on' : 'rule-mark'} aria-pressed={on} onClick={(event) => onPick(event.shiftKey || event.ctrlKey || event.metaKey)}>
      <span className="rule-mark__when">
        <span>{day}</span>
        <span className="rule-mark__muted">{time}</span>
      </span>
      <span className="rule-mark__body">
        <span className="rule-mark__what">{why ? summary.reasons.join(' · ') : <KindList kinds={summary.kinds} colors={colors} />}</span>
        <span className="rule-mark__muted rule-mark__who">
          {why && <KindList kinds={summary.kinds} colors={colors} />}
          {why && who !== '' && ' · '}
          {who}
        </span>
      </span>
      <span className="rule-mark__size">
        <Lines added={summary.added} removed={summary.removed} />
        <span className="rule-mark__muted">{t.stats.rules.fileCount(summary.files)}</span>
      </span>
    </button>
  )
}

function FileRow({ file, open, colors, onToggle }: { file: RuleSetFile; open: boolean; colors: Colors; onToggle: () => void }) {
  return (
    <li>
      <Fold open={open} onOpenChange={onToggle} summaryClassName="rule-file" summary={<>
        <span className="rule-file__where">
          <PlaceDot project={file.project} colors={colors} />
          {file.project ?? t.stats.rules.shared}
        </span>
        <span className="rule-file__path">{fileLabel(file.display)}</span>
        <Lines added={file.added} removed={file.removed} />
      </>}>
        {() => file.changes.length === 0 ? <p className="stats-section__note rule-file__note">{t.stats.rules.noText}</p> : <FileDiff file={file} />}
      </Fold>
    </li>
  )
}

function SetView({ set, colors, trackerUrls }: { set: RuleSet; colors: Colors; trackerUrls: TrackerUrls }) {
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
            : set.files.map((file) => <FileRow key={file.key} file={file} open={open === file.key} colors={colors} onToggle={() => setOpen(open === file.key ? null : file.key)} />)}
        </ul>
      </div>
    </li>
  )
}

function Picked({ marks, before, after, now, colors, trackerUrls }: { marks: RuleMark[]; before: string; after: string; now: Date; colors: Colors; trackerUrls: TrackerUrls }) {
  const sets = marks.flatMap((mark) => mark.sets).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const days = new Map<string, RuleSet[]>()
  for (const set of sets) {
    const day = dayLabel(new Date(set.at), now)
    days.set(day, [...(days.get(day) ?? []), set])
  }
  const summary = markSummary({ fromAt: before, toAt: after, sets })
  const [day, time] = spanText(before, after, now)
  return (
    <Fold key={`${before}:${after}`} className="rule-card" summaryClassName="rule-card__head" summary={<>
        <span className="rule-card__title">{t.stats.rules.changed}</span>
        <span className="stats-section__note">
          {day} {time} · {t.stats.rules.fileCount(summary.files)}
        </span>
        <Lines added={summary.added} removed={summary.removed} />
      </>}>
      {[...days].map(([label, each]) => (
        <section key={label} className="rule-day">
          {days.size > 1 && <h4 className="rule-day__title">{label}</h4>}
          <ol className="rule-sets">
            {each.map((set) => (
              <SetView key={set.id} set={set} colors={colors} trackerUrls={trackerUrls} />
            ))}
          </ol>
        </section>
      ))}
    </Fold>
  )
}

export function RulesSection({
  fold,
  busy,
  loaded,
  marks,
  kinds,
  purposes,
  places,
  onFilter,
  picked,
  onPick,
  base,
  range,
  models,
  onModels,
  modelOptions,
  colors,
  trackerUrls,
}: {
  fold: FoldControl
  busy: boolean
  loaded: Loaded<StatsRules> | null
  marks: RuleMark[]
  kinds: RuleKind[] | null
  purposes: RulePurpose[] | null
  places: RulePlace[] | null
  onFilter: (next: { kinds?: RuleKind[] | null; purposes?: RulePurpose[] | null; places?: RulePlace[] | null }) => void
  picked: string[]
  onPick: (key: string, extend: boolean) => void
  base: Omit<CompareQuery, 'before' | 'after' | 'days'>
  range: DayRange
  models: Pick<CompareQuery, 'beforeModels' | 'afterModels'>
  onModels: (next: Pick<CompareQuery, 'beforeModels' | 'afterModels'>) => void
  modelOptions: string[]
  colors: Colors
  trackerUrls: TrackerUrls
}) {
  const rules = loadedData(loaded)
  const span = pickedSpan(marks, picked)
  const now = new Date()
  const listed = marks.flatMap((mark) => mark.sets.flatMap((set) => set.files.flatMap((file) => (file.project === null ? [] : [file.project]))))
  const projects = base.projects !== null && base.projects.length > 0 ? base.projects : [...new Set(listed)].sort()
  return (
    <Section
      title={t.stats.rules.title}
      help={`${t.stats.rules.note}. ${t.stats.rules.pick} ${t.stats.rules.coverage}`}
      fold={fold}
      busy={busy}
      aside={
        <>
          {rules !== null && <span className="stats-section__count">{marks.length}</span>}
        </>
      }
    >
      <div className="rule-filters">
        <Chips label={t.stats.rules.files} options={ruleKindLabels()} all={MARK_KINDS} on={kinds} onChange={(next) => onFilter({ kinds: next })} />
        <Chips
          label={t.stats.rules.purpose}
          options={RULE_PURPOSES.map((purpose) => [purpose, purposeLabel(purpose)])}
          all={RULE_PURPOSES}
          on={purposes}
          onChange={(next) => onFilter({ purposes: next })}
        />
        <PlaceLegend on={places} projects={projects} colors={colors} onChange={(next) => onFilter({ places: next })} />
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
                  <MarkRow mark={mark} on={picked.includes(key)} now={now} colors={colors} onPick={(extend) => onPick(key, extend)} />
                </li>
              )
            })}
          </ol>
        </>
      )}
      {rules !== null && <ComparePanel defaultDays={rules.compare.days} models={models} onModels={onModels} options={modelOptions}
        query={span === null ? {
          ...base, before: new Date(`${range.from}T00:00:00`).toISOString(), after: new Date(`${range.to}T00:00:00`).toISOString(),
          from: new Date(`${range.from}T00:00:00`).toISOString(), to: new Date(`${addDays(range.to, 1)}T00:00:00`).toISOString(),
        } : { ...base, before: span.before, after: span.after }} />}
      {span !== null && <Picked marks={span.marks} before={span.before} after={span.after} now={now} colors={colors} trackerUrls={trackerUrls} />}
    </Section>
  )
}
