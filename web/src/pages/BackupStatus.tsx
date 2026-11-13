import type { EvenKeelState } from '../../../src/state.js'
import { formatMoment } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useCommand } from '../live/useCommand.js'
import { Band, Fact, FactList } from '../ui/blocks.js'
import { Section } from './settingsParts.js'

/** The newest checked copy of the state database, its folder and a copy made on demand (BTN-1083); applied at once, no draft. */
export function BackupStatus({ state }: { state: EvenKeelState }) {
  const copy = useCommand()
  const now = useNow(60_000)
  const view = state.backup
  if (view === undefined) return null
  // A failed copy is told by the banner over every page; here it only frames the last good one in red.
  return (
    <Section title={t.shared.backupLast} className="backup-status">
      {copy.failure !== null && <Band tone="error">{say(copy.failure)}</Band>}
      <FactList className="backup-status__facts">
        <Fact label={t.shared.backupChecked} tone={view.failure !== null ? 'danger' : view.at === null ? 'warn' : 'ok'}>
          <dd>{view.at === null ? t.shared.backupNone : formatMoment(view.at, now)}</dd>
        </Fact>
        <Fact label={t.shared.backupFolder} className="backup-status__folder">
          <dd className="backup-status__dir">{view.dir}</dd>
        </Fact>
      </FactList>
      <div className="backup-status__actions">
        <button type="button" className="button" disabled={view.running || copy.sending} onClick={() => void copy.send('storage/backup')}>
          {view.running ? t.shared.backupRunning : t.shared.backupNow}
        </button>
      </div>
    </Section>
  )
}
