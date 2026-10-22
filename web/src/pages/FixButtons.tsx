import { useNavigate } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
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
  const target = fix.to === 'project' ? (fix.project ?? project) : null
  if (fix.to === 'project' && target === null) return null
  return (
    <button type="button" className={className} onClick={() => go(fix, target)}>
      {fix.to === 'accounts' ? t.fix.accounts : fix.to === 'project' ? t.fix.project : fix.tab === 'secrets' ? t.fix.access : t.fix.shared}
    </button>
  )
}

/** Opens the place of a fix; `project` — the project of a fix in a project's settings, by its id or its key. */
export function useFix() {
  const navigate = useNavigate()
  const { state } = useLive()
  return (fix: NoticeFix, project: string | null) => {
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
