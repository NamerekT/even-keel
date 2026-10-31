import { MOVE_SETTINGS, type StatusMoves } from '../../../src/chain/moves.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { EvenKeelState, ProfileView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { MovesSection, useProfileStatuses } from './MoveFields.js'
import { changed, edited, reverted } from './settingsDraft.js'
import { marksOf, sameBy } from './settingsParts.js'
import { useDraft } from './settingsStore.js'
import type { SourceTab } from './SourceDialog.js'
import { movesFrom, movesText, type MovesText } from './statusMoves.js'

const same = sameBy([])

/** A source's status moves tab of its settings window: shown only where its tracker moves statuses. */
export const MOVES_TAB = 'moves'

const movesScope = (project: string, feed: string | null) => `moves:${project}:${feed ?? ''}`

/** Whether a source's status moves are edited and not saved: its line's mark while its window is shut. */
export function useSourceMovesDirty(project: string, feed: string | null, own: StatusMoves | undefined): boolean {
  const [current] = useDraft(movesScope(project, feed), movesText(own), same)
  return changed(current!, MOVE_SETTINGS, same).length > 0
}

/**
 * The status moves a source of a project sets over its profile's (BTN-554): the project's main tracker (`feed: null`) or
 * one of its feeds. `rules` — the source's as drafted, to offer the statuses in its chain. `tab` is `null` where the
 * source's tracker moves none; `save` sends only an edit and answers whether it went through.
 */
export function useSourceMoves({ state, project, feed, kind, profile, rules, saved: own }: {
  state: EvenKeelState | null
  project: string
  feed: string | null
  kind: string
  profile: ProfileView | undefined
  rules: ChainRules
  saved: StatusMoves | undefined
}) {
  const { send, sending, failure } = useCommand()
  const moves = state !== null && state.profiles.kinds.find((each) => each.kind === kind)?.moves === true
  const saved = movesText(own)
  const [current, setDraft] = useDraft(movesScope(project, feed), saved, same)
  const draft = current!
  const statuses = useProfileStatuses(moves ? profile?.id : undefined)
  const revert = (keys: readonly string[]) => setDraft(reverted(draft, saved, keys))
  const marks = marksOf(draft, saved, same, revert)
  const dirty = moves && changed(draft, MOVE_SETTINGS, same).length > 0
  const tab: SourceTab | null = !moves
    ? null
    : {
        id: MOVES_TAB,
        title: t.profiles.moves.title,
        dirty,
        render: () => (
          <MovesSection
            hint={`${t.profiles.moves.hint} ${profile === undefined ? '' : t.profiles.moves.sourceHint(profile.name)}`.trim()}
            rules={rules}
            statuses={statuses}
            text={draft.edit as MovesText}
            profile={profile?.moves ?? {}}
            idPrefix={`${project}-${feed ?? 'main'}`}
            marks={marks}
            onEdit={(key, value) => setDraft(edited(draft, key, value))}
          />
        ),
      }
  return {
    tab,
    dirty,
    sending,
    failure,
    save: async (): Promise<boolean> => !dirty || send('project/moves', { project, feed, moves: movesFrom(draft.edit) }),
    revert: () => revert(MOVE_SETTINGS),
  }
}
