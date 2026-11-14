import { Fold, FoldList, FoldPresence } from '../ui/Fold.js'
import { useState } from 'react'
import { ProtectionWarnings, protectionShown } from './ProtectionWarnings.js'
import { kindShown, noticeId, notDismissed, NoticeButtons } from '../layout/NoticeButtons.js'
import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { completionNotices, moveNotices } from '../completion.js'
import { openToAllSources, type OpenSource } from '../openToAll.js'
import { openTab, projectScope, SETTINGS_HASH, sourceScope } from './settingsStore.js'
import { useCommand } from '../live/useCommand.js'
import { activeChain, chainStatus, projectLabel, projectPath } from '../state.js'
import { Band, FoldBand } from '../ui/blocks.js'
import { ProjectLinks, Said } from '../ui/ProjectLinks.js'
import { BranchDriftBand } from './BranchField.js'
import { GitFoundBand } from './GitFoundBand.js'
import { gitFoundNotice } from './gitFound.js'
import { NoticeFixButton } from './FixButtons.js'
import { PullFixButton } from './PullButtons.js'
import { TrackerFixButtons } from './TrackerFixButtons.js'
import { UntrustedCommands } from './TrustCommands.js'
import { forwardTone, projectErrors, warningTasks } from './noticeGroups.js'
import './projectNotices.css'

export function ProjectNotices({ state, project, rows, settingsOpen = false }: { state: EvenKeelState; project: string; rows: string[]; settingsOpen?: boolean }) {
  const { send, failure } = useCommand()
  const [dismissing, setDismissing] = useState(false)
  const tasks = warningTasks(state.chain.leftovers[project] ?? [], rows)
  const tone = forwardTone(state.forwards[project])
  const count = tasks.length + (tone !== null && tone !== 'error' ? 1 : 0)
  const errors = [...projectErrors(state.chain.projects[project]?.error ?? null, chainStatus(state.chain, project)), ...completionNotices(state, project), ...moveNotices(state, project)]
    .filter((error) => notDismissed(state, errorMark(error.code, project), JSON.stringify(error)))
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
      <FoldPresence>{tone !== null && tone !== 'error' ? <Forward state={state} project={project} /> : null}</FoldPresence>
    </>
  )
  // The open settings show the drift under the main branch field: the card leaves it to them.
  const drift = settingsOpen ? undefined : driftShown(state, project)
  const found = gitFoundNotice(state, project) !== null
  const open = openToAllSources(state, project)
  const shown = drift !== undefined || errors.length > 0 || tone !== null || count > 0 || failure !== null || found || protectionShown(state, project) || open.length > 0
  return (
    <FoldPresence>{shown ? <div className="project-notices">
      <ProtectionWarnings state={state} project={project} />
      <OpenToAll project={project} sources={open} />
      <FoldPresence>{found ? <GitFoundBand state={state} project={project} /> : null}</FoldPresence>
      <FoldPresence>{drift !== undefined ? <BranchDriftBand project={project} drift={drift} closable /> : null}</FoldPresence>
      <FoldList items={errors.map((error, index) => ({
        key: `${error.code}-${index}`, children:
          <Band tone="error" action={
            <>
              <NoticeFixButton project={project} notice={error} />
              <PullFixButton state={state} project={project} error={error} />
              <TrackerFixButtons state={state} project={project} error={error} />
              <NoticeButtons stamps={{ [errorMark(error.code, project)]: JSON.stringify(error) }} small />
            </>
          }>
            <Said notice={error} />
            <UntrustedCommands notice={error} />
          </Band>
      }))} />
      <FoldPresence>{tone === 'error' ? <Forward state={state} project={project} /> : null}</FoldPresence>
      <FoldPresence>{count > 1 ? (
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
      ) : null}</FoldPresence>
      <FoldPresence>{count <= 1 ? warnings : null}</FoldPresence>
      <FoldPresence>{failure !== null ? <Band tone="error">{say(failure)}</Band> : null}</FoldPresence>
    </div> : null}</FoldPresence>
  )
}

/**
 * A public repository a source takes tasks from without a label (BTN-1134): it stays while the tracker says so, with no
 * "Got it", since only the rules turn it off. "Rules" opens the tracker tab, and the main tracker's rules on it.
 */
function OpenToAll({ project, sources }: { project: string; sources: OpenSource[] }) {
  const toRules = (source: OpenSource) => {
    if (!source.feed) openTab(sourceScope(project), 'rules')
    openTab(projectScope(project), 'tracker')
  }
  return <FoldList items={sources.map((source) => ({
    key: `open-${source.reader}`, children:
      <Band tone="note" action={
        <Link className="button button--small" to={{ pathname: projectPath(project), hash: SETTINGS_HASH }} onClick={() => toRules(source)}>{t.project.openToAllRules}</Link>
      }>
        {t.project.openToAll(source.place)}
      </Band>
  }))} />
}

/** An error holds the chain: it takes only "Got it", back when anything it says changes (BTN-759). */
const errorMark = (code: string, project: string) => noticeId(`error:${code}`, project)

/** The main checkout on another branch, unless turned off or closed while it said the same (BTN-759). */
function driftShown(state: EvenKeelState, project: string) {
  const drift = state.branchDrift[project]
  if (drift === undefined || !kindShown(state, 'branch.drift', project)) return undefined
  return notDismissed(state, noticeId('branch.drift', project), JSON.stringify(drift)) ? drift : undefined
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
          <Fold className="forward__more" summary={<>{t.project.forwardMore}</>}>
            {() => (
              <>
                <ul className="forward__files">
                  {files.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>{conflict.detail !== undefined && conflict.detail.trim() !== '' && <pre className="forward__output">{conflict.detail.trim()}</pre>}
              </>
            )}
          </Fold>
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
  const tasks = [...new Set(leftovers.map((each) => each.task))]

  return (
    <div className="leftovers">
      <FoldList items={tasks.map((task) => ({ key: task, children:
        <div className="notice notice--warn leftovers__item">
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
      }))} />
      {failure !== null && <p className="project__error">{say(failure)}</p>}
    </div>
  )
}
