import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { changed, edited, reverted, type Values } from './settingsDraft.js'
import { linesOf, marksOf, RuleFields, sameBy, SaveBar } from './settingsParts.js'
import { ruleChoicesOf } from './settingsRows.js'
import { useDraft } from './settingsStore.js'
import { useVocabularies } from './useVocabularies.js'

/** The chain rules a tracker profile sets (BTN-66): statuses and labels, which differ from tracker to tracker. */
export const PROFILE_RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
const same = sameBy(PROFILE_RULE_KEYS)

/** The settings page's group of a tracker profile's rules. */
export const profileGroup = (id: string) => `profile:${id}`

const textsOf = (rules: ProfileView['rules']): Values => Object.fromEntries(PROFILE_RULE_KEYS.map((key) => [key, (rules[key] ?? []).join('\n')]))

/** A blank list is the profile setting nothing there: the shared rules, or a project's own, stay. */
const rulesOf = (values: Values): ProfileView['rules'] =>
  Object.fromEntries(
    PROFILE_RULE_KEYS.flatMap((key) => {
      const lines = linesOf(values[key] as string)
      return lines.length === 0 ? [] : [[key, lines]]
    }),
  )

/** The rules of the projects on a tracker profile, between the shared ones and a project's own; offered what its projects name. */
export function ProfileRules({ state, profile }: { state: EvenKeelState; profile: ProfileView }) {
  const { send, sending, failure } = useCommand()
  const saved = textsOf(profile.rules)
  const [current, setDraft] = useDraft(profileGroup(profile.id), saved, same)
  const draft = current!
  const vocabularies = useVocabularies(profile.projectIds)
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  const tasks = state.tasks.filter((task) => profile.projectIds.includes(task.project))
  const dirty = changed(draft, PROFILE_RULE_KEYS, same).length > 0

  return (
    <form
      className="settings__form settings-page__form"
      aria-labelledby="settings-group"
      onSubmit={(event) => {
        event.preventDefault()
        void send('profiles/rules', { id: profile.id, rules: rulesOf(draft.edit) })
      }}
    >
      <h2 id="settings-group" className="settings-page__group">
        {t.profiles.rulesOf(profile.name)}
      </h2>
      <p className="settings__hint">{profile.projectIds.length === 0 ? t.profiles.rulesNoProjects : t.profiles.rulesFor(profile.projects.join(', '))}</p>
      <RuleFields
        keys={PROFILE_RULE_KEYS}
        hint={t.profiles.rulesHint}
        text={(key) => draft.edit[key] as string}
        onEdit={(key, text) => setDraft(edited(draft, key, text))}
        errorOf={() => null}
        marks={marks}
        choices={ruleChoicesOf(tasks, vocabularies)}
      />
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <SaveBar shown={dirty} canSave={!sending} onRevert={() => revert(PROFILE_RULE_KEYS)} />
    </form>
  )
}
