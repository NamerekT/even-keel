import { useEffect, useState } from 'react'
import { MOVE_SETTINGS, type MoveSetting, type StatusMoves } from '../../../src/chain/moves.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { TaskStatus } from '../../../src/tracker/model.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Select } from '../ui/Select.js'
import type { Value } from './settingsDraft.js'
import { fieldId, Row, Section, type Marks } from './settingsParts.js'
import { moveLabel, moveOptions, type MovesText } from './statusMoves.js'

/** The statuses a tracker profile's tracker lists (BTN-554): `undefined` — reading, `null` — none read. */
export function useProfileStatuses(id: string | undefined): TaskStatus[] | null | undefined {
  const { query } = useLive()
  const [found, setFound] = useState<TaskStatus[] | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setFound(undefined)
    if (id === undefined) return setFound(null)
    query<TaskStatus[] | null>('profiles/statuses', { id }).then(
      (statuses) => live && setFound(statuses === null || statuses.length === 0 ? null : statuses),
      () => live && setFound(null),
    )
    return () => {
      live = false
    }
  }, [id])
  return found
}

const LABELS: Record<MoveSetting, () => [string, string]> = {
  start: () => [t.profiles.moves.start, t.profiles.moves.startHint],
  review: () => [t.profiles.moves.review, t.profiles.moves.reviewHint],
  done: () => [t.profiles.moves.done, t.profiles.moves.doneHint],
}

/**
 * The three moves of a profile, or of a source over its profile's (`profile` — the profile's values): start, pull request,
 * completion. `statuses` — the tracker's, read once as the form opens.
 */
export function MoveFields({ rules, statuses, text, profile, idPrefix, marks, onEdit }: {
  rules: ChainRules
  statuses: readonly TaskStatus[] | null | undefined
  text: MovesText
  profile?: StatusMoves
  idPrefix: string
  marks: Marks
  onEdit: (key: MoveSetting, value: string) => void
}) {
  return (
    <>
      {statuses === undefined && <p className="settings__hint">{t.profiles.moves.loading}</p>}
      {statuses === null && <p className="settings__hint">{t.profiles.moves.unread}</p>}
      {MOVE_SETTINGS.map((key) => {
        const [label, hint] = LABELS[key]()
        const id = fieldId(`${idPrefix}-move-${key}`)
        return (
          <Row
            key={key}
            className={marks.box(key)}
            label={label}
            hint={hint}
            htmlFor={id}
            control={<Select id={id} className="settings__text" value={text[key]} options={moveOptions(key, rules, statuses ?? [], text[key], profile)} onChange={(value) => onEdit(key, value)} />}
          >
            {marks.note(key, (value: Value) => moveLabel(key, String(value), profile))}
          </Row>
        )
      })}
    </>
  )
}

/** The moves as a card of a settings form. */
export function MovesSection(props: Parameters<typeof MoveFields>[0] & { hint?: string }) {
  return (
    <Section title={t.profiles.moves.title} hint={props.hint ?? t.profiles.moves.hint} className="settings__moves">
      <MoveFields {...props} />
    </Section>
  )
}
