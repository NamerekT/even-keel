import { runLabelView } from './runLabel.js'
import './runLabel.css'

export function RunLabelTag({ label, as: Tag = 'span' }: { label: string; as?: 'span' | 'li' }) {
  const run = runLabelView(label)
  return (
    <Tag className="tag run-label" title={label}>
      {run === null ? label : <>
        <span className="run-label__provider">{run.provider}{run.model !== null && ' |\u00a0'}</span>
        {run.model !== null && <span className="run-label__model">{run.model}</span>}
      </>}
    </Tag>
  )
}
