import { taskRunText, type TaskRun } from '../../../src/sessions/runs.js'
import { EffortBarsIcon } from './icons.js'
import { effortLevel, runView } from './runLabel.js'
import './runLabel.css'

/**
 * An effort as its bar scale after the text before it, a word's space apart (`spaced`); nothing for an effort without
 * a scale, whose word stays in the tip of what holds it.
 */
export function EffortBars({ effort, spaced, className }: { effort: string | null; spaced: boolean; className: string }) {
  const level = effortLevel(effort)
  if (level === null || effort === null) return null
  return <span className={className}>{spaced && ' '}<EffortBarsIcon level={level} label={effort} /></span>
}

/** What a task's sessions run on (`state.runs`): the provider, the model without its route, the effort as a bar scale. */
export function RunLabelTag({ run, as: Tag = 'span' }: { run: TaskRun; as?: 'span' | 'li' }) {
  const { provider, model, effort } = runView(run)
  return (
    <Tag className="tag run-label" title={taskRunText(run)}>
      {provider !== null && <span className="run-label__provider">{provider}{model !== null && ' | '}</span>}
      {model !== null && <span className="run-label__model">{model}</span>}
      <EffortBars effort={effort} spaced={provider !== null} className="run-label__effort" />
    </Tag>
  )
}
