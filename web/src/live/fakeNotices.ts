import { withDismissed } from '../../../src/notice/kinds.js'
import type { EvenKeelState } from '../../../src/state.js'

/** The banners' "Got it" and "Don't show again" and the "Notices" switches in `dev:fake` (BTN-759); `null` — not one of them. */
export function fakeNoticesCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (name === 'notices/dismiss') return { ...state, noticesDismissed: withDismissed(state.noticesDismissed ?? {}, body.entries as Record<string, string>) }
  if (name !== 'notices/mute') return null
  const kind = String(body.kind)
  const shown = body.shown as boolean | null
  const entry = (current: Record<string, boolean> | undefined) => {
    const { [kind]: _, ...rest } = current ?? {}
    return shown === null || (body.project === null && shown) ? rest : { ...rest, [kind]: shown }
  }
  const { config } = state
  if (body.project === null) return { ...state, config: { ...config, shared: { ...config.shared, notices: entry(config.shared.notices) } } }
  const project = String(body.project)
  const form = config.projects[project]!
  return { ...state, config: { ...config, projects: { ...config.projects, [project]: { ...form, notices: entry(form.notices) } } } }
}
