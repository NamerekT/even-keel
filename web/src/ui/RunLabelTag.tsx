import { t } from '../i18n/index.js'
import { runLabelView } from './runLabel.js'
import './runLabel.css'

/** `off`: the project's run labels are off, so the label does not steer the session (BTN-741). */
export function RunLabelTag({ label, as: Tag = 'span', off = false }: { label: string; as?: 'span' | 'li'; off?: boolean }) {
  const run = runLabelView(label)
  return (
    <Tag className={off ? 'tag run-label run-label--off' : 'tag run-label'} title={off ? `${label}
${t.card.run.offTip}` : label}>
      {run === null ? label : <>
        <span className="run-label__provider">{run.provider}{run.model !== null && ' |\u00a0'}</span>
        {run.model !== null && <span className="run-label__model">{run.model}</span>}
      </>}
    </Tag>
  )
}
