import { useNavigate } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { packagesPath } from '../tools/packageGroups.js'
import { trackerPackage, trackerPackageOf } from '../tools/packageView.js'
import { Tipped } from '../ui/Tipped.js'

/** What turns the task description back on: auto, which gives it while no package brings the server, unless the shared one is off. */
export const briefBack = (shared: boolean | null): boolean | null => (shared === false ? true : null)

/**
 * What a chain paused because its sessions would not see their task is fixed by (BTN-656), each in one press: the
 * tracker's package turned on for the project — or, with none installed, the add dialog over the project's packages — and the description.
 */
export function TrackerFixButtons({ state, project, error }: { state: EvenKeelState; project: string; error: Notice | null }) {
  const navigate = useNavigate()
  const { send, sending } = useCommand()
  if (error?.code !== 'chain.noTrackerMcp') return null
  const name = trackerPackageOf(state.packages, error.params.server)
  const tracker = trackerPackage(state.packages, project)
  const plugin = tracker?.state === 'missing' ? tracker.plugin : null
  const form = state.config.projects[project]
  const turnOn = () => (name === null ? navigate(packagesPath(project, plugin)) : void send('packages/project', { project, name, choice: 'on' }))
  const briefOn = () => form !== undefined && void send('project/settings', { project, ...form, brief: briefBack(state.config.shared.brief), base: form })
  return (
    <span className="tracker-fix">
      <Tipped tip={t.project.trackerPackageTip} inline>
        <button type="button" className="button button--small" disabled={sending} onClick={turnOn}>
          {name === null ? t.project.trackerPackageAdd : t.project.trackerPackageOn(name)}
        </button>
      </Tipped>
      {form !== undefined && (
        <Tipped tip={t.project.trackerBriefTip} inline>
          <button type="button" className="button button--small" disabled={sending} onClick={briefOn}>
            {t.project.trackerBriefOn}
          </button>
        </Tipped>
      )}
    </span>
  )
}
