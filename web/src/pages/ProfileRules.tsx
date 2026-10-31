import { MOVE_SETTINGS } from '../../../src/chain/moves.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { knownStatuses, type RuleLevel } from './ruleRows.js'
import { RuleForm, ruleText } from './RuleForm.js'
import { changed, edited, reverted, type Values } from './settingsDraft.js'
import { linesOf, marksOf, sameBy, SaveBar } from './settingsParts.js'
import { ruleChoicesOf } from './settingsRows.js'
import { useDraft } from './settingsStore.js'
import { useVocabularies } from './useVocabularies.js'
import { MovesSection, useProfileStatuses } from './MoveFields.js'
import { movesFrom, profileMovesText, type MovesText } from './statusMoves.js'

/** The chain rules a tracker profile sets (BTN-66): statuses and labels, which differ from tracker to tracker. */
export const PROFILE_RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
const same = sameBy(PROFILE_RULE_KEYS)
const sameMoves = sameBy([])

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

/** The rules of the projects on a tracker profile and, for a tracker that moves statuses, its status moves. */
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
  const shared = state.config.shared.chain
  const own = rulesOf(draft.edit)
  const rules: ChainRules = { ...shared, ...own }
  const origins = Object.fromEntries(Object.keys(shared).map((key) => [key, key in own ? 'profile' : 'shared'])) as Record<keyof ChainRules, RuleLevel>
  const moves = useProfileMoves(state, profile, rules)

  return (
    <form
      className="settings__form"
      aria-label={t.profiles.rulesOf(profile.name)}
      onSubmit={(event) => {
        event.preventDefault()
        // The rules first: the moves are checked against the rules the profile ends up with.
        void (async () => (!dirty || (await send('profiles/rules', { id: profile.id, rules: rulesOf(draft.edit) }))) && (await moves.save(send)))()
      }}
    >
      <p className="settings__hint">{profile.projectIds.length === 0 ? t.profiles.rulesNoProjects : t.profiles.rulesFor(profile.projects.join(', '))}</p>
      <RuleForm
        level="profile"
        hint={t.profiles.rulesHint}
        rules={rules}
        inherited={shared}
        origins={origins}
        profileName={profile.name}
        statuses={knownStatuses(
          vocabularies.map((each) => each.statuses),
          tasks.map((task) => task.status),
          rules,
        )}
        labels={ruleChoicesOf(tasks, vocabularies).labels}
        modelLabels={state.config.shared.modelLabels}
        // The profile leaves a key unset where it would only repeat the shared one.
        onEdit={(changes) => setDraft(changes.reduce((each, [key, value]) => edited(each, key, ruleText(value)), draft))}
        errorOf={() => null}
        marks={marks}
      />
      {moves.section}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <SaveBar
        shown={dirty || moves.dirty}
        canSave={!sending}
        onRevert={() => {
          revert(PROFILE_RULE_KEYS)
          moves.revert()
        }}
      />
    </form>
  )
}

/** The settings page's group of a tracker profile's status moves, a draft apart from its rules. */
const movesGroup = (id: string) => `profile-moves:${id}`

/**
 * Where Even Keel moves the tasks of the profile's projects by itself (BTN-554), offered by the rules as drafted; no
 * section where the profile's tracker moves no statuses. `save` sends only an edit.
 */
function useProfileMoves(state: EvenKeelState, profile: ProfileView, rules: ChainRules) {
  const shown = state.profiles.kinds.find((kind) => kind.kind === profile.kind)?.moves === true
  const saved = profileMovesText(profile.moves)
  const [current, setDraft] = useDraft(movesGroup(profile.id), saved, sameMoves)
  const draft = current!
  const statuses = useProfileStatuses(shown ? profile.id : undefined)
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, sameMoves, revert)
  const dirty = shown && changed(draft, MOVE_SETTINGS, sameMoves).length > 0
  return {
    dirty,
    section: shown && (
      <MovesSection rules={rules} statuses={statuses} text={draft.edit as MovesText} idPrefix={profile.id} marks={marks} onEdit={(key, value) => setDraft(edited(draft, key, value))} />
    ),
    save: async (send: (name: string, body: Record<string, unknown>) => Promise<boolean>) => !dirty || send('profiles/moves', { id: profile.id, moves: movesFrom(draft.edit) }),
    revert: () => revert(MOVE_SETTINGS),
  }
}
