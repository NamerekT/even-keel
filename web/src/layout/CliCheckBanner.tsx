import type { CliCheckView, EvenKeelState } from '../../../src/state.js'
import { say } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Banner } from './Banner.js'
import { kindShown, noticeId, notDismissed, NoticeButtons } from './NoticeButtons.js'

/**
 * The automatic CLI check of each agent (BTN-569): waiting for a free account folder, running, or its last result, a
 * failure with the step that failed. "Got it" hides a check until it moves on, on every device; "Don't show again"
 * turns off all but the failures, which only take "Got it" (BTN-759).
 */
export function CliCheckBanner() {
  const { state } = useLive()
  const shown = cliChecksShown(state)
  if (shown.length === 0) return <Banner />

  const failed = shown.some(isFailed)
  const settled = shown.every((each) => each.notice.code === 'cliCheck.passed' || each.notice.code === 'cliCheck.running')
  return (
    <Banner tone={failed ? 'error' : undefined} role={settled ? 'status' : 'alert'}>
      <div className="banner__inner">
        {shown.length === 1 ? (
          <span>{say(shown[0]!.notice)}</span>
        ) : (
          <div>
            <ul className="banner__list">
              {shown.map((each) => (
                <li key={each.agent}>{say(each.notice)}</li>
              ))}
            </ul>
          </div>
        )}
        <span className="banner__actions">
          <NoticeButtons stamps={Object.fromEntries(shown.map((each) => [markOf(each), stampOf(each)]))} kind={failed ? undefined : 'cli.check'} />
        </span>
      </div>
    </Banner>
  )
}

function cliChecksShown(state: EvenKeelState | null): CliCheckView[] {
  const kind = kindShown(state, 'cli.check')
  return (state?.cliChecks ?? []).filter((each) => (kind || isFailed(each)) && notDismissed(state, markOf(each), stampOf(each)))
}

const isFailed = (view: CliCheckView) => view.notice.code === 'cliCheck.failed'

const markOf = (view: CliCheckView): string => noticeId(`cli.check:${view.agent}`)

/** A check is the same while its notice and moment are. */
const stampOf = (view: CliCheckView): string => `${view.notice.code}@${view.at}`
