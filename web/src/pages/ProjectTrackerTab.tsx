import { BUILTIN } from '../../../src/builtin/model.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { ConfigView, EvenKeelState, ProjectForm } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import type { TrackerVocabulary } from '../../../src/tracker/source.js'
import { t } from '../i18n/index.js'
import { Band } from '../ui/blocks.js'
import { FeedList } from './FeedList.js'
import { MilestoneOrder } from './MilestoneOrder.js'
import { ProjectTracker } from './ProjectTracker.js'
import { MilestoneFields, RuleForm, ruleText } from './RuleForm.js'
import { SourceDialog, SourceLine } from './SourceDialog.js'
import type { useSourceMoves } from './SourceMoves.js'
import { profileOf, switchOf } from './projectForm.js'
import type { PanelFields } from './projectSettingsFields.js'
import { same, STATUS_KEYS } from './projectSettingsDraft.js'
import { effectiveRules, knownStatuses, ruleOrigins } from './ruleRows.js'
import { changed, edited, reverted, type Value } from './settingsDraft.js'
import { RULE_KEYS, rulesText, Section } from './settingsParts.js'
import type { ruleChoicesOf } from './settingsRows.js'

/** The "Tracker" tab of the project settings panel, with the main tracker's window of rules, milestones and moves. */
export function ProjectTrackerTab({
  fields,
  project,
  form,
  state,
  config,
  tasks,
  mainTasks,
  ruleProfile,
  chain,
  ruleChoices,
  vocabularies,
  moves,
  configuring,
  setConfiguring,
  sourceTab,
  openSourceTab,
  canSave,
  leftover,
  save,
}: {
  fields: PanelFields
  project: string
  form: ProjectForm
  state: EvenKeelState | null
  config: ConfigView
  tasks: readonly Task[]
  /** The main tracker's tasks only: a feed's are offered in its own window (BTN-553). */
  mainTasks: readonly Task[]
  ruleProfile: ReturnType<typeof profileOf>
  chain: ChainRules
  ruleChoices: ReturnType<typeof ruleChoicesOf>
  vocabularies: readonly TrackerVocabulary[]
  moves: ReturnType<typeof useSourceMoves>
  configuring: boolean
  setConfiguring: (configuring: boolean) => void
  sourceTab: string
  openSourceTab: (tab: string) => void
  canSave: boolean
  leftover: Notice | null
  save: () => Promise<boolean>
}) {
  const { draft, setDraft, saved, text, editAll, revert, marks, errorOf, notes, input, inheritedSwitch } = fields
  const shared = config.shared
  const locked = config.trackerLocked.includes(project)
  const inheritedOf = (tracker: string) => effectiveRules(shared.chain, [], profileOf(state, project, tracker)?.rules ?? {})
  const inherited = inheritedOf(text('tracker'))
  const origins = ruleOrigins(chain, inherited, ruleProfile?.rules ?? {})
  // Another tracker names other statuses: the project's own status lists go back to what the new one inherits, saved with it.
  const statusesOf = (tracker: string): [string, Value][] => STATUS_KEYS.map((key) => [key, rulesText(inheritedOf(tracker))[key]])
  const statusesReset = text('tracker') !== saved.tracker && form.ownRules.some((key) => STATUS_KEYS.includes(key))
  const trackerTitle = config.trackers.find((each) => each.name === text('tracker'))?.title ?? text('tracker')
  const onBuiltin = text('tracker') === BUILTIN
  return (
    <>
      <Section title={t.settings.sections.tracker}>
        {state !== null && (
          <ProjectTracker
            state={state}
            project={project}
            tracker={text('tracker')}
            trackerProject={text('trackerProject')}
            known={text('tracker') === saved.tracker && text('trackerProject') === saved.trackerProject}
            locked={locked}
            hasTasks={mainTasks.length > 0}
            trackerMark={marks.note('tracker')}
            trackerNote={notes('tracker')}
            box={marks.box('trackerProject')}
            mark={marks.note('trackerProject')}
            note={notes('trackerProject')}
            invalid={errorOf('trackerProject') !== null}
            onEdit={(tracker, value) =>
              setDraft(
                tracker === text('tracker')
                  ? edited(draft, 'trackerProject', value)
                  : tracker === saved.tracker
                    ? reverted(draft, saved, ['tracker', 'trackerProject', ...STATUS_KEYS])
                    : statusesOf(tracker).reduce((each, [key, value]) => edited(each, key, value), edited(edited(draft, 'tracker', tracker), 'trackerProject', '')),
              )
            }
          />
        )}
        {text('tracker') !== 'github' && input('intakeLabel', t.settings.intakeLabel, t.settings.intakeLabelHint, t.settings.intakeLabelNone)}
        {inheritedSwitch('fillMilestone', t.settings.fillMilestone, t.settings.fillMilestoneHint, shared.fillMilestone)}
      </Section>
      {state !== null && (
        <FeedList
          state={state}
          project={project}
          tasks={tasks}
          mainTitle={trackerTitle}
          main={
            <SourceLine
              kind={text('tracker')}
              title={trackerTitle}
              sourceKey={state.projectKeys[project] ?? ''}
              own={form.ownRules.length > 0 || form.moves !== undefined}
              dirty={changed(draft, RULE_KEYS, same).length > 0 || moves.dirty}
              onConfigure={() => setConfiguring(true)}
            >
              {statusesReset && (
                <Band tone="warn" action={<button type="button" className="button button--small" onClick={() => setConfiguring(true)}>{t.settings.sourceConfigure}</button>}>
                  {t.settings.statusRulesReset}
                </Band>
              )}
            </SourceLine>
          }
        />
      )}
      {(configuring || sourceTab !== '') && (
        <SourceDialog
          kind={text('tracker')}
          initialTab={sourceTab === '' ? undefined : sourceTab}
          sourceKey={state?.projectKeys[project] ?? project}
          title={ruleProfile?.name ?? trackerTitle}
          tabs={[
            // The built-in tracker's statuses and labels are fixed (BTN-767): only which tasks are the project's.
            ...(onBuiltin ? [] : [{
              id: 'rules',
              title: t.settings.rules,
              dirty: changed(draft, ['active', 'terminal', 'requiredLabels', 'excludedLabels'], same).length > 0,
              render: () => (
                <RuleForm
                  level="project"
                  rules={chain}
                  inherited={inherited}
                  origins={origins}
                  profileName={ruleProfile?.name ?? null}
                  statuses={knownStatuses(
                    vocabularies.map((each) => each.statuses),
                    mainTasks.map((task) => task.status),
                    chain,
                  )}
                  labels={ruleChoices.labels}
                  onEdit={(changes) => editAll(changes.map(([key, value]) => [key, ruleText(value)]))}
                  errorOf={errorOf}
                  marks={marks}
                />
              ),
            }]),
            {
              id: 'milestones',
              fields: ['requiredMilestones', 'excludedMilestones'],
              title: t.settings.milestones,
              dirty: changed(draft, ['requiredMilestones', 'excludedMilestones'], same).length > 0,
              render: () => (
                <>
                <Section title={t.settings.milestones} hint={t.settings.milestonesHint}>
                  <MilestoneFields
                    level="project"
                    rules={chain}
                    inherited={inherited}
                    origins={origins}
                    milestones={ruleChoices.milestones}
                    onlyUnavailable={onBuiltin && ruleChoices.milestones.length === 0 ? t.settings.milestonesNone : undefined}
                    text={text}
                    onEdit={editAll}
                    errorOf={errorOf}
                    marks={marks}
                  />
                </Section>
                <MilestoneOrder project={project} milestones={state?.chain.projects[project]?.milestones ?? []} saved={form.milestoneOrder ?? []} />
                </>
              ),
            },
            ...(moves.tab === null || onBuiltin ? [] : [moves.tab]),
          ]}
          canSave={canSave && !moves.sending}
          failure={leftover ?? moves.failure}
          onSave={async () => (await save()) && moves.save()}
          onRevert={() => {
            revert(statusesReset || text('tracker') !== saved.tracker ? RULE_KEYS.filter((key) => !STATUS_KEYS.includes(key)) : RULE_KEYS)
            moves.revert()
          }}
          onClose={() => {
            setConfiguring(false)
            openSourceTab('')
          }}
        />
      )}
    </>
  )
}
