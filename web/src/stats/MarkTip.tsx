import type { RuleMark, RuleSet } from '../../../src/stats/rules.js'
import { formatMoment } from '../format.js'
import { PURPOSE_LABELS, driftText, precisionText, setTitle, shortPath } from './marks.js'

const TIP_SETS = 5
const TIP_FILES = 4

const PURPOSES = new Map(PURPOSE_LABELS)

export function SetNote({ set }: { set: RuleSet }) {
  const note = set.note
  if (note === null) return null
  const precision = precisionText(note.precision)
  const drift = driftText(note.drift)
  return (
    <>
      {(note.purpose.length > 0 || precision !== null) && (
        <span className="rule-tags">
          {note.purpose.map((purpose) => (
            <span key={purpose} className={`rule-tag rule-tag--${purpose}`}>
              {PURPOSES.get(purpose)}
            </span>
          ))}
          {precision !== null && <span className="rule-tag rule-tag--rough">время {precision}</span>}
        </span>
      )}
      {note.reason !== '' && <span className="rule-reason">{note.reason}</span>}
      {drift !== null && <span className="rule-drift">Импорт и транскрипт расходятся: {drift}</span>}
    </>
  )
}

export function MarkTip({ mark, side }: { mark: RuleMark; side: 'left' | 'right' }) {
  const now = new Date()
  const from = formatMoment(mark.fromAt, now)
  const to = formatMoment(mark.toAt, now)
  return (
    <div className={`chart__tip chart__tip--${side} mark-tip`} role="tooltip">
      <strong>{from === to ? `Правка правил · ${to}` : `Правки правил · ${from} — ${to}`}</strong>
      {mark.sets.slice(0, TIP_SETS).map((set) => (
        <div key={set.id} className="mark-tip__set">
          <span className="mark-tip__title">{setTitle(set)}</span>
          <SetNote set={set} />
          {set.files.slice(0, TIP_FILES).map((file) => (
            <span key={file.key} className="chart__tip-row mark-tip__file">
              {set.id.startsWith('i:') ? file.display : shortPath(file.display)}
              {set.id.startsWith('i:') ? null : <Lines added={file.added} removed={file.removed} />}
            </span>
          ))}
          {set.files.length > TIP_FILES && <span className="mark-tip__more">и ещё файлов: {set.files.length - TIP_FILES}</span>}
        </div>
      ))}
      {mark.sets.length > TIP_SETS && <span className="mark-tip__more">и ещё наборов: {mark.sets.length - TIP_SETS}</span>}
      <span className="mark-tip__hint">Клик — до и после, Shift-клик — вторая метка</span>
    </div>
  )
}

export function Lines({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="rule-lines">
      <span className="rule-lines__added">+{added}</span> <span className="rule-lines__removed">−{removed}</span>
    </span>
  )
}
