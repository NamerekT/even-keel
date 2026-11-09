import { useNavigate } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { packagesPath } from '../tools/packageGroups.js'
import { choiceTip, trackerPackage, type TrackerChoice } from '../tools/packageView.js'
import { Tipped } from '../ui/Tipped.js'

/** What turns the task description back on: auto, which gives it while no package brings the server, unless the shared one is off. */
export const briefBack = (shared: boolean | null): boolean | null => (shared === false ? true : null)

/**
 * What a chain paused because its sessions would not see their task is fixed by (BTN-656), each in one press: a tracker
 * package turned on for the project — Even Keel's tasks server first where it serves the tracker, the tracker's own
 * server beside it (BTN-874), or the add dialog over the project's packages when none is installed — and the description.
 */
export function TrackerFixButtons({ state, project, error }: { state: EvenKeelState; project: string; error: Notice | null }) {
  const navigate = useNavigate()
  const { send, sending } = useCommand()
  if (error?.code !== 'chain.noTrackerMcp') return null
  const tracker = trackerPackage(state.packages, project)
  const choices: (TrackerChoice | null)[] = tracker?.state === 'missing' && tracker.choices.length > 0 ? tracker.choices : [null]
  const form = state.config.projects[project]
  const turnOn = (choice: TrackerChoice | null) =>
    choice?.name != null ? void send('packages/project', { project, name: choice.name, choice: 'on' }) : navigate(packagesPath(project, choice?.plugin ?? null))
  const briefOn = () => form !== undefined && void send('project/settings', { project, ...form, brief: briefBack(state.config.shared.brief), base: form })
  return (
    <span className="tracker-fix">
      {choices.map((choice) => (
        <Tipped key={choice?.server ?? ''} tip={choice === null ? t.project.trackerPackageTip : `${t.project.trackerPackageTip} ${choiceTip(choice)}`} inline>
          <button type="button" className="button button--small" disabled={sending} onClick={() => turnOn(choice)}>
            {choice?.name != null ? t.project.trackerPackageOn(choice.name) : t.project.trackerPackageAdd(choice?.plugin ?? null)}
          </button>
        </Tipped>
      ))}
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
