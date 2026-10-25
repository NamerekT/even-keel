import { useState } from 'react'
import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { activeChain, projectLabel, projectPath } from '../state.js'
import { Band, FoldBand } from '../ui/blocks.js'
import { ProjectLinks, Said } from '../ui/ProjectLinks.js'
import { NoticeFixButton } from './FixButtons.js'
import { forwardTone, warningTasks } from './noticeGroups.js'
import './projectNotices.css'

export function ProjectNotices({ state, project, rows }: { state: EvenKeelState; project: string; rows: string[] }) {
  const { send, failure } = useCommand()
  const [dismissing, setDismissing] = useState(false)
  const tasks = warningTasks(state.chain.leftovers[project] ?? [], rows)
  const tone = forwardTone(state.forwards[project])
  const count = tasks.length + (tone !== null && tone !== 'error' ? 1 : 0)
  const error = state.chain.projects[project]?.error
  const summary = [
    ...(tasks.length > 0 ? [t.project.cleanupSummary(tasks.slice(0, 3).join(', ') + (tasks.length > 3 ? '…' : ''))] : []),
    ...(tone !== null && tone !== 'error' ? [forwardSummary(state, project)] : []),
  ].join(' · ')
  const dismissAll = async () => {
    setDismissing(true)
    try {
      for (const task of tasks) if (!(await send('chain/dismiss', { project, task }))) break
    } finally {
      setDismissing(false)
    }
  }
  const warnings = (
    <>
      <Leftovers state={state} project={project} rows={rows} busy={dismissing} />
      {tone !== null && tone !== 'error' && <Forward state={state} project={project} />}
    </>
  )
  if (!error && tone === null && count === 0 && failure === null) return null
  return (
    <div className="project-notices">
      {error && (
        <Band tone="error"><Said notice={error} /></Band>
      )}
      {tone === 'error' && <Forward state={state} project={project} />}
      {count > 1 ? (
        <FoldBand
          title={t.project.warnings(count)}
          summary={summary}
          action={tasks.length > 1 ? (
            <button type="button" className="button button--small" disabled={dismissing} aria-busy={dismissing || undefined} onClick={() => void dismissAll()}>
              {t.project.dismissAll}
            </button>
          ) : undefined}
        >
          {warnings}
        </FoldBand>
      ) : warnings}
      {failure !== null && <Band tone="error">{say(failure)}</Band>}
    </div>
  )
}

function forwardSummary(state: EvenKeelState, project: string): string {
  const forward = state.forwards[project]!
  const into = projectLabel(state, forward.into)
  if ((forward.behind ?? 0) === 0) return t.project.forwardPushFailed(into)
  if (forward.agent !== undefined) {
    return activeChain(state.chain, forward.into)?.current?.task === forward.agent
      ? t.project.forwardAgent(into) : t.project.forwardAgentAsked(into)
  }
  return t.project.forwardWaits(forward.behind ?? 0, into)
}

/**
 * A release project's commits that wait to go into the project it merges into, why, and "Carry now" (BTN-172); a
 * conflict is one line with "Resolve with the agent" and its files and git's output folded, and while the agent's
 * session is asked for, a line that leads to its row (BTN-369).
 */
function Forward({ state, project }: { state: EvenKeelState; project: string }) {
  const { send, sending, failure } = useCommand()
  const forward = state.forwards[project]
  const push = forward?.last?.push ?? null
  if (forward === undefined || ((forward.behind ?? 0) === 0 && push === null)) return null
  const waiting = (forward.behind ?? 0) > 0
  const conflict = waiting && forward.held && forward.hold?.code === 'forward.conflict' ? forward.hold : null

  if (waiting && forward.agent !== undefined) {
    const running = activeChain(state.chain, forward.into)?.current?.task === forward.agent
    return (
      <div className="leftovers">
        <Band
          tone="note"
          className="forward__agent"
          action={
            <Link to={{ pathname: projectPath(forward.into), hash: forward.agent }} className="button button--small">
              {t.project.forwardAgentOpen}
            </Link>
          }
        >
          <span>
            <ProjectLinks text={running ? t.project.forwardAgent(forward.into) : t.project.forwardAgentAsked(forward.into)} />
          </span>
        </Band>
      </div>
    )
  }

  if (conflict !== null) {
    const { files } = conflict.params
    return (
      <div className="leftovers">
        <Band
          tone="error"
          action={
            <button type="button" className="button button--primary" disabled={sending} onClick={() => void send('forward/resolve', { project })}>
              {t.project.forwardResolve}
            </button>
          }
        >
          <strong>
            <ProjectLinks text={t.project.forwardConflict(forward.behind ?? 0, project, forward.into, files.length)} />
          </strong>
          <details className="forward__more">
            <summary>{t.project.forwardMore}</summary>
            <ul className="forward__files">
              {files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
            {conflict.detail !== undefined && conflict.detail.trim() !== '' && <pre className="forward__output">{conflict.detail.trim()}</pre>}
          </details>
        </Band>
        {failure !== null && <p className="project__error">{say(failure)}</p>}
      </div>
    )
  }

  return (
    <div className="leftovers">
      <div className={waiting && forward.held ? 'notice notice--error leftovers__item' : 'notice notice--warn leftovers__item'}>
        <div className="leftovers__text">
          <strong>
            <ProjectLinks text={waiting ? t.project.forwardWaits(forward.behind ?? 0, forward.into) : t.project.forwardPushFailed(forward.into)} />
          </strong>
          {forward.hold !== null && (
            <p className="leftovers__line">
              <Said notice={forward.hold} />
            </p>
          )}
          <NoticeFixButton project={project} notice={forward.hold} />
          {!waiting && push !== null && (
            <p className="leftovers__line">
              <Said notice={push} />
            </p>
          )}
        </div>
        {waiting && (
          <button type="button" className="button" disabled={sending} onClick={() => void send('forward/carry', { project })}>
            {t.project.forwardNow}
          </button>
        )}
      </div>
      {failure !== null && <p className="project__error">{say(failure)}</p>}
    </div>
  )
}

/** A task whose chain row shows what its cleanup left, `rows`, is told of there, with its own "Done" (BTN-332). */
function Leftovers({ state, project, rows, busy }: { state: EvenKeelState; project: string; rows: string[]; busy: boolean }) {
  const { send, sending, failure } = useCommand()
  const leftovers = (state.chain.leftovers[project] ?? []).filter((each) => !rows.includes(each.task))
  if (leftovers.length === 0) return null
  const tasks = [...new Set(leftovers.map((each) => each.task))]

  return (
    <div className="leftovers">
      {tasks.map((task) => (
        <div key={task} className="notice notice--warn leftovers__item">
          <div className="leftovers__text">
            <strong>{t.project.leftover(task)}</strong>
            {leftovers
              .filter((each) => each.task === task)
              .map((each, index) => (
                <p key={index} className="leftovers__line">
                  <Said notice={each.notice} />
                </p>
              ))}
          </div>
          <button type="button" className="button" disabled={sending || busy} onClick={() => void send('chain/dismiss', { project, task })}>
            {t.project.dismiss}
          </button>
        </div>
      ))}
      {failure !== null && <p className="project__error">{say(failure)}</p>}
    </div>
  )
}
