import { useNavigate } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { projectOfPath, projectPath } from '../state.js'
import { type NoticeFix, noticeFixOf } from './noticeFix.js'
import { openTab, projectScope, SETTINGS_HASH, SHARED_SCOPE } from './settingsStore.js'

/** A button under a notice to the place it is fixed at; nothing where the page has none. `project` — the project it is shown at. */
export function NoticeFixButton({ project, notice }: { project: string | null; notice: Notice | null }) {
  const fix = noticeFixOf(notice)
  return fix === null ? null : <FixButton project={project} fix={fix} />
}

export function FixButton({ project, fix, className = 'button button--small notice-fix' }: { project: string | null; fix: NoticeFix; className?: string }) {
  const go = useFix()
  if (fix.to === 'resume') return project === null ? null : <ResumeButton project={project} className={className} />
  const target = fix.to === 'project' ? (fix.project ?? project) : null
  if (fix.to === 'project' && target === null) return null
  return (
    <button type="button" className={className} onClick={() => go(fix, target)}>
      {fix.to === 'accounts' ? t.fix.accounts : fix.to === 'project' ? t.fix.project : fix.tab === 'trackers' ? t.fix.trackers : fix.tab === 'page' ? t.fix.page : t.fix.shared}
    </button>
  )
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
    if (fix.to === 'shared') {
      openTab(SHARED_SCOPE, fix.tab)
      return void navigate('/settings')
    }
    if (project === null) return
    const id = state === null ? project : projectOfPath(state, project).project
    openTab(projectScope(id), fix.tab)
    navigate({ pathname: projectPath(id), hash: SETTINGS_HASH })
  }
}
