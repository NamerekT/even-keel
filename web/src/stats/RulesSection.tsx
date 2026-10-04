import type { TrackerUrls } from '../../../src/state.js'
import { useState } from 'react'
import { RULE_PURPOSES, type RulePurpose } from '../../../src/stats/rule-imports.js'
import { type CompareQuery, type RuleKind, type RuleMark, type RuleSet, type RuleSetFile, type StatsRules } from '../../../src/stats/rules.js'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AnswerNotice, Section, TaskKey, loadedData, useStatsAnswer, type Loaded } from './common.js'
import { MARK_KINDS, markKey, markTitle, pickedSpan, purposeLabel, ruleKindLabels, setTitle, shortPath, toggleChip } from './marks.js'
import { Lines, SetNote } from './MarkTip.js'
import { COMPARE_DAYS, RuleCompare } from './RuleCompare.js'
import './rules.css'

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

function SetView({ set, trackerUrls }: { set: RuleSet; trackerUrls: TrackerUrls }) {
  const [open, setOpen] = useState<string | null>(null)
  const imported = set.id.startsWith('i:')
  return (
    <li className="rule-set">
      <div className="rule-set__head">
        {set.task !== null ? <TaskKey id={set.task} trackerUrls={trackerUrls} /> : <strong>{setTitle(set)}</strong>}
        {set.task !== null && set.title !== null && <span>{set.title}</span>}
        <span className="stats-section__note">{formatMoment(set.at, new Date())}</span>
      </div>
      <SetNote set={set} />
      {imported ? (
        <ul className="rule-set__files">
          {(set.note?.files ?? []).map((file) => (
            <li key={file.path}>
              <span className="rule-set__path">{file.path}</span> <span className="stats-section__note">{t.stats.rules.actions[file.action]}</span>
              {file.summary !== '' && <span className="rule-set__summary">{file.summary}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="rule-set__files">
          {set.files.map((file) => (
            <li key={file.key}>
              <button type="button" className="rule-set__file" aria-expanded={open === file.key} title={file.display} onClick={() => setOpen(open === file.key ? null : file.key)}>
                <span className="rule-set__path">{shortPath(file.display)}</span>
                <Lines added={file.added} removed={file.removed} />
              </button>
              {open === file.key &&
                (file.changes.length === 0 ? (
                  <p className="stats-section__note">{t.stats.rules.noText}</p>
                ) : (
                  <FileDiff file={file} />
                ))}
            </li>
          ))}
        </ul>
      )}
    </li>
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
              const on = picked.includes(key)
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={on ? 'rule-mark rule-mark--on' : 'rule-mark'}
                    aria-pressed={on}
                    onClick={(event) => onPick(key, event.shiftKey || event.ctrlKey || event.metaKey)}
                  >
                    <span className="rule-mark__at">{formatMoment(mark.toAt, now)}</span>
                    <span className="rule-mark__sets">{markTitle(mark)}</span>
                    <span className="stats-section__note">{t.stats.rules.fileCount(mark.sets.reduce((sum, set) => sum + set.files.length, 0))}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          {span === null ? (
            <p className="stats-section__note">{t.stats.rules.pick}</p>
          ) : (
            <div className="rule-picked">
              <ul className="rule-picked__sets">{span.marks.flatMap((mark) => mark.sets).map((set) => <SetView key={set.id} set={set} trackerUrls={trackerUrls} />)}</ul>
              <div className="rule-picked__compare">
                <header className="stats-section__head">
                  <h3 className="rule-picked__title">{t.stats.rules.compare}</h3>
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
                </header>
                <Compare query={{ ...base, before: span.before, after: span.after }} days={days ?? rules.compare.days} />
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  )
}
