import { taskRunText, type TaskRun } from '../../../src/sessions/runs.js'
import { runView } from './runLabel.js'
import './runLabel.css'

/** What a task's sessions run on (`state.runs`): the provider, the model without its route, the effort. */
export function RunLabelTag({ run, as: Tag = 'span' }: { run: TaskRun; as?: 'span' | 'li' }) {
  const { provider, model, effort } = runView(run)
  return (
    <Tag className="tag run-label" title={taskRunText(run)}>
      {provider !== null && <span className="run-label__provider">{provider}{model !== null && ' | '}</span>}
      {model !== null && <span className="run-label__model">{model}</span>}
      {effort !== null && <span className="run-label__effort">{provider !== null && ' · '}{effort}</span>}
    </Tag>
  )
}
