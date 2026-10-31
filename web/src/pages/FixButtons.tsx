import { useNavigate } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { issueLink, projectOfPath, projectPath } from '../state.js'
import { type NoticeFix, noticeFixOf } from './noticeFix.js'
import { openTab, projectScope, SETTINGS_HASH, SHARED_SCOPE } from './settingsStore.js'
import type { EvenKeelState } from '../../../src/state.js'
import { linkedProfile } from './ProjectTracker.js'
import { profileGroup } from './ProfileRules.js'
import { taskFeed } from './settingsRows.js'

/** A button under a notice to the place it is fixed at; nothing where the page has none. `project` — the project it is shown at. */
export function NoticeFixButton({ project, notice }: { project: string | null; notice: Notice | null }) {
  const fix = noticeFixOf(notice)
  return fix === null ? null : <FixButton project={project} fix={fix} />
}

export function FixButton({ project, fix, className = 'button button--small notice-fix' }: { project: string | null; fix: NoticeFix; className?: string }) {
  const go = useFix()
  const { state } = useLive()
  if (fix.to === 'tracker') {
    const url = state === null ? null : issueLink(state.trackerUrls, fix.task)
    return url === null ? null : <a className={className} href={url} target="_blank" rel="noreferrer">{t.card.openIn(null)}</a>
  }
  if (fix.to === 'resume') return project === null ? null : <ResumeButton project={project} className={className} />
  const target = fix.to === 'project' ? (fix.project ?? project) : fix.to === 'moves' ? project : null
  if ((fix.to === 'project' || fix.to === 'moves') && target === null) return null
  return (
    <button type="button" className={className} onClick={() => go(fix, target)}>
      {fixLabel(fix)}
    </button>
  )
}

/** What the button to a place in the settings or the accounts says. */
export function fixLabel(fix: Extract<NoticeFix, { to: 'accounts' | 'project' | 'shared' | 'moves' }>): string {
  if (fix.to === 'moves') return t.fix.moves
  return fix.to === 'accounts' ? t.fix.accounts : fix.to === 'project' ? t.fix.project : fix.tab === 'trackers' ? t.fix.trackers : fix.tab === 'page' ? t.fix.page : t.fix.shared
}

/** Resumes a chain paused on what is fixed outside the page: its next launch is the check that it is fixed. */
function ResumeButton({ project, className }: { project: string; className: string }) {
  const { send, sending } = useCommand()
  return (
    <button type="button" className={className} disabled={sending} onClick={() => void send('chain/resume', { project })}>
      {t.fix.resume}
    </button>
  )
}

/** Opens the place of a fix; `project` — the project of a fix in a project's settings, by its id or its key. */
export function useFix() {
  const navigate = useNavigate()
  const { state } = useLive()
  return (fix: Exclude<NoticeFix, { to: 'resume' }>, project: string | null) => {
    if (fix.to === 'accounts') return void navigate('/accounts')
    if (fix.to === 'tracker') return
    if (fix.to === 'shared') {
      openTab(SHARED_SCOPE, fix.tab)
      return void navigate('/settings')
    }
    if (project === null) return
    const id = state === null ? project : projectOfPath(state, project).project
    if (fix.to === 'moves' && fix.level === 'profile') {
      openTab(SHARED_SCOPE, state === null ? 'rules' : (movesProfile(state, id, fix.task) ?? 'rules'))
      return void navigate('/settings')
    }
    // A source's own moves are in its window on the project's Tracker tab, a feed's too.
    openTab(projectScope(id), fix.to === 'moves' ? 'tracker' : fix.tab)
    navigate({ pathname: projectPath(id), hash: SETTINGS_HASH })
  }
}

/** The settings tab of the profile a task's source reads on: its feed's or the project's main tracker's. */
function movesProfile(state: EvenKeelState, project: string, task: string): string | undefined {
  const feed = taskFeed(state.config.feeds[project] ?? [], task)
  const kind = feed?.tracker ?? state.config.projects[project]?.tracker
  const profile = linkedProfile(state.profiles.profiles.filter((each) => each.kind === kind), feed?.id ?? project)
  return profile === undefined ? undefined : profileGroup(profile.id)
}
