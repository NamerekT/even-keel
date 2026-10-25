import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { activeChain, projectPath } from '../state.js'
import { Band } from '../ui/blocks.js'
import { ProjectLinks, Said } from '../ui/ProjectLinks.js'
import { NoticeFixButton } from './FixButtons.js'

/**
 * A release project's commits that wait to go into the project it merges into, why, and "Carry now" (BTN-172); a
 * conflict is one line with "Resolve with the agent" and its files and git's output folded, and while the agent's
 * session is asked for, a line that leads to its row (BTN-369).
 */
export function Forward({ state, project }: { state: EvenKeelState; project: string }) {
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
      <div className={forward.held ? 'notice notice--error leftovers__item' : 'notice notice--warn leftovers__item'}>
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
export function Leftovers({ state, project, rows }: { state: EvenKeelState; project: string; rows: string[] }) {
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
          <button type="button" className="button" disabled={sending} onClick={() => void send('chain/dismiss', { project, task })}>
            {t.project.dismiss}
          </button>
        </div>
      ))}
      {failure !== null && <p className="project__error">{say(failure)}</p>}
    </div>
  )
}
