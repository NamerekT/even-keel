import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Band } from '../ui/blocks.js'
import { Said } from '../ui/ProjectLinks.js'
import { NoticeFixButton } from './FixButtons.js'
import { gitFoundMark, gitFoundNotice } from './gitFound.js'

/**
 * The folder of a project without git has become a repository (BTN-1025): "Turn on git" opens the switch's dialog,
 * "Not now" closes the band for this repository until the folder stops being one and becomes one again.
 */
export function GitFoundBand({ state, project }: { state: EvenKeelState; project: string }) {
  const { send, sending, failure } = useCommand()
  const found = gitFoundNotice(state, project)
  if (found === null) return null
  return (
    <Band
      tone="note"
      action={
        <>
          <NoticeFixButton project={project} notice={found.notice} />
          <button type="button" className="button button--small" disabled={sending} onClick={() => void send('notices/dismiss', { entries: { [gitFoundMark(project)]: found.stamp } })}>
            {t.settings.gitSwitch.notNow}
          </button>
          {failure !== null && <span className="settings__error">{say(failure)}</span>}
        </>
      }
    >
      <Said notice={found.notice} />
    </Band>
  )
}
