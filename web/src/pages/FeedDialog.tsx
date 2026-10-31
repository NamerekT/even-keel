import type { ChainRules } from '../../../src/chain/rules.js'
import type { EvenKeelState, FeedView } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { linkedProfile } from './ProjectTracker.js'
import { feedRulesOf, knownStatuses, ownRulesOf, ruleOrigins } from './ruleRows.js'
import { MilestoneFields, RuleForm, ruleText } from './RuleForm.js'
import { changed, edited, reverted, type Value } from './settingsDraft.js'
import { marksOf, RULE_KEYS, rulesOf, rulesText, sameBy, Section, type RuleKey } from './settingsParts.js'
import { ruleChoicesOf, sourceTasks } from './settingsRows.js'
import { useDraft } from './settingsStore.js'
import { SourceDialog, type SourceTab } from './SourceDialog.js'
import { useVocabularies } from './useVocabularies.js'

const same = sameBy(RULE_KEYS)
const RULE_TAB_KEYS: readonly RuleKey[] = ['active', 'terminal', 'requiredLabels', 'excludedLabels']
const MILESTONE_KEYS: readonly RuleKey[] = ['requiredMilestones', 'excludedMilestones']

/** The scope of a feed's settings window: its draft outlives the window, as the panel's does. */
const feedScope = (project: string, feed: string) => `feed:${project}:${feed}`

/** A feed's rules (BTN-553): its own keys over its profile's over the shared ones, as the draft of its window. */
export function useFeedDraft(state: EvenKeelState, project: string, feed: FeedView) {
  const profile = linkedProfile(
    state.profiles.profiles.filter((each) => each.kind === feed.tracker),
    feed.id,
  )
  const profileRules: Partial<ChainRules> = profile?.rules ?? {}
  const inherited = feedRulesOf(state.config.shared.chain, profileRules)
  const saved = rulesText(feedRulesOf(state.config.shared.chain, profileRules, feed.chain))
  const [current, setDraft] = useDraft(feedScope(project, feed.id), saved, same)
  const draft = current!
  return { draft, setDraft, saved, inherited, profile, profileRules, dirty: changed(draft, RULE_KEYS, same).length > 0 }
}

/** The settings window of a feed: its rules and which of its tracker's tasks are the project's, from its own tracker only. */
export function FeedDialog({ state, project, feed, tasks, modelLabels, onClose }: {
  state: EvenKeelState
  project: string
  feed: FeedView
  tasks: readonly Task[]
  modelLabels: boolean
  onClose: () => void
}) {
  const { draft, setDraft, saved, inherited, profile, profileRules } = useFeedDraft(state, project, feed)
  const { send, sending, failure } = useCommand()
  const vocabularies = useVocabularies([feed.id])
  const own = sourceTasks(tasks, state.config.feeds[project] ?? [], feed.id)
  const choices = ruleChoicesOf(own, vocabularies)
  const chain = rulesOf(draft.edit as Record<RuleKey, Value>)
  const origins = ruleOrigins(chain, inherited, profileRules)
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  const editAll = (changes: [string, Value][]) => setDraft(changes.reduce((each, [key, value]) => edited(each, key, value), draft))
  const noError = () => null
  const tracker = state.config.trackers.find((each) => each.name === feed.tracker)?.title ?? feed.tracker
  const tabs: SourceTab<'rules' | 'milestones'>[] = [
    {
      id: 'rules',
      title: t.settings.rules,
      dirty: changed(draft, RULE_TAB_KEYS, same).length > 0,
      render: () => (
        <RuleForm
          level="project"
          ownName={t.settings.originFeed}
          rules={chain}
          inherited={inherited}
          origins={origins}
          profileName={profile?.name ?? null}
          statuses={knownStatuses(
            vocabularies.map((each) => each.statuses),
            own.map((task) => task.status),
            chain,
          )}
          labels={choices.labels}
          modelLabels={modelLabels}
          hint={t.settings.feedRulesHint}
          onEdit={(changes) => editAll(changes.map(([key, value]) => [key, ruleText(value)]))}
          errorOf={noError}
          marks={marks}
        />
      ),
    },
    {
      id: 'milestones',
      title: t.settings.milestones,
      dirty: changed(draft, MILESTONE_KEYS, same).length > 0,
      render: () => (
        <Section title={t.settings.milestones} hint={t.settings.milestonesHint}>
          <MilestoneFields
            level="project"
            rules={chain}
            inherited={inherited}
            origins={origins}
            milestones={choices.milestones}
            text={(key) => draft.edit[key] as string}
            onEdit={editAll}
            errorOf={noError}
            marks={marks}
          />
        </Section>
      ),
    },
  ]
  return (
    <SourceDialog
      kind={feed.tracker}
      sourceKey={feed.key}
      title={profile?.name ?? tracker}
      tabs={tabs}
      canSave={!sending}
      failure={failure}
      onSave={() => send('project/feed/rules', { project, feed: feed.id, rules: ownRulesOf(chain, inherited) })}
      onRevert={() => revert(RULE_KEYS)}
      onClose={onClose}
    />
  )
}
