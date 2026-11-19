import type { ChangeGroup, TaskChange } from '../../../src/tracker/history.js'
import { builtinStatus } from '../../../src/builtin/model.js'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { Fold } from '../ui/Fold.js'
import { EvenKeelIcon } from '../ui/icons.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { changeAuthor, changeRows, changeRun, journalModel } from './journalView.js'
import './cardChanges.css'

/** One author's consecutive changes, quieter than a comment and without its bubble. */
export function CardChanges({ group }: { group: ChangeGroup }) {
  const author = group.name ?? changeAuthor(group.by, t.card.journal)
  const model = journalModel(group.model)
  const at = new Date(group.at).toISOString()
  return <li className="task-card__comment task-change">
    <span className="task-change__axis" aria-hidden="true"><span className="task-change__avatar">{group.by === 'service' ? <EvenKeelIcon /> : author.charAt(0)}</span></span>
    <div className="task-change__body">
      <div className="task-card__comment-head"><strong>{author}</strong>{model !== null && <RunLabelTag run={model} />}<time dateTime={at}>{formatMoment(at, new Date())}</time></div>
      <div className="task-change__table" role="table" aria-label={t.card.journal.filters.changes}>
        {changeRows(group).map((row, index) => <div className="task-change__row" role="row" key={index}>
          <span className="task-change__field" role="rowheader">{t.card.journal.fields[row.field]}</span>
          <div className="task-change__value" role="cell">{row.changes.map((change, at) => <ChangeValue key={at} change={change} />)}</div>
        </div>)}
      </div>
    </div>
  </li>
}

function ChangeValue({ change }: { change: TaskChange }) {
  if (change.field === 'description') return <div className="task-change__description"><Fold summary={<>{t.card.journal.changed}<span>{t.card.journal.showDiff}</span></>}>
    {() => <div className="task-change__diff">{(change.diff ?? []).map((line, index) => <div className={`task-change__line task-change__line--${line.kind}`} key={index}>
      {line.kind === 'skipped' ? t.card.journal.skipped(line.lines) : <><span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text || ' '}</code></>}
    </div>)}</div>}
  </Fold></div>
  if (change.field === 'created') return <span>{t.card.journal.created}</span>
  if (change.field === 'moved') return <span>{t.card.journal.moved(change.to ?? '')}</span>
  if (['label', 'blocks', 'blockedBy', 'relates', 'subtask'].includes(change.field)) return <span className={`tag task-change__chip${change.to === null ? ' task-change__old' : ''}`}>{change.to === null ? <del>{change.from}</del> : `+ ${change.to}`}</span>
  return <><Value change={change} value={change.from} old /><span className="task-change__arrow" aria-label={t.card.journal.to}>→</span><Value change={change} value={change.to} /></>
}

function Value({ change, value, old = false }: { change: TaskChange; value: string | null; old?: boolean }) {
  // No value is a muted dash, never struck out: nothing was there to remove.
  if (value === null) return <span className="task-change__old" role="img" aria-label={t.card.journal.none}>—</span>
  const run = change.field === 'run' ? changeRun(value) : null
  const status = change.field === 'status' ? builtinStatus(value) : undefined
  const text = change.field === 'estimate' ? t.card.journal.minutes(Number(value)) : change.field === 'priority' ? t.card.priorities[value as keyof typeof t.card.priorities] ?? value : value
  const content = run !== null ? <RunLabelTag run={run} /> : status !== undefined ? <span className={`task-card__status task-card__status--${status.category}`}><span className="task-card__dot" />{value}</span> : old ? <del>{text}</del> : text
  return <span className={old ? 'task-change__old' : undefined}>{content}</span>
}
