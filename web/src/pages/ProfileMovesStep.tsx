import { useEffect, useState } from 'react'
import { defaultMoves } from '../../../src/chain/moves.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { MoveFields, useProfileStatuses } from './MoveFields.js'
import type { Marks } from './settingsParts.js'
import { movesFrom, type MovesText } from './statusMoves.js'

const PLAIN: Marks = { box: () => 'settings__field', note: () => null }

/**
 * The step after a new profile of a tracker that moves statuses is saved (BTN-554): its three moves, offered the first
 * started status in the chain and the one named for review; "Skip" leaves them unset, as they are on a profile's tab.
 */
export function ProfileMovesStep({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const statuses = useProfileStatuses(id)
  const rules = state?.config.shared.chain
  const [text, setText] = useState<MovesText | null>(null)

  useEffect(() => {
    if (text !== null || statuses == null || rules === undefined) return
    const offered = defaultMoves(rules, statuses)
    setText({ start: offered.start ?? '', review: offered.review ?? '', done: '' })
  }, [statuses])

  const save = async () => {
    if (text !== null && (await send('profiles/moves', { id, moves: movesFrom(text) }))) onClose()
  }

  return (
    <div className="add-package__form profile-form">
      <div className="add-package__body">
        <h3 className="ui-label">{t.profiles.moves.stepTitle}</h3>
        <p className="settings__hint">{statuses === null ? t.profiles.moves.stepUnread : t.profiles.moves.stepHint(name)}</p>
        {statuses === undefined && <p className="settings__hint">{t.profiles.moves.loading}</p>}
        {text !== null && rules !== undefined && (
          <MoveFields rules={rules} statuses={statuses} text={text} idPrefix={id} marks={PLAIN} onEdit={(key, value) => setText({ ...text, [key]: value })} />
        )}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </div>
      <footer className="add-package__foot">
        <span className="add-package__spacer" />
        <button type="button" className="button" onClick={onClose}>
          {t.profiles.moves.skip}
        </button>
        {statuses !== null && (
          <button type="button" className="button button--primary" disabled={sending || text === null} onClick={() => void save()}>
            {t.profiles.moves.save}
          </button>
        )}
      </footer>
    </div>
  )
}
