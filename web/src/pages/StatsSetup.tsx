import { useNavigate, useSearchParams } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import type { TallyMode } from '../../../src/stats/mode.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { STATS_SERVER, stepPath } from './setupSteps.js'
import { TallyModes, TallyServerFields } from './TallyChoice.js'

/**
 * The setup's last question, about stats: what Tally gives and costs, then where it writes. No stats and the local
 * database are set at once; the user's own Postgres takes a second part with its connection. Either ends the first run.
 */
export function StatsStep({ state, onDone }: { state: EvenKeelState; onDone: () => void }) {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const server = search.get('db') === 'server'

  const pick = async (mode: TallyMode) => {
    if (mode === 'server') return void navigate(STATS_SERVER)
    if (await send('stats/tally', { mode })) onDone()
  }

  if (server)
    return (
      <section key="server" className="tally-step setup__part">
        <h2 className="setup__subtitle">
          {t.tally.stepConnection}: {t.tally.modes.server}
        </h2>
        <p className="queue__hint">{t.tally.modeHints.server}</p>
        <TallyServerFields state={state} onDone={onDone} onCancel={() => void navigate(stepPath('stats'))} />
      </section>
    )
  return (
    <div key="stats" className="stats-setup__intro">
      <div className="stats-setup__about">
        <img className="stats-setup__preview" src="/stats-preview.png" alt={t.tally.preview} width={1200} height={640} />
        <p className="stats-setup__lead">{t.tally.lead}</p>
      </div>
      <ul className="stats-setup__facts">
        {t.tally.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <TallyModes chosen={null} current={state.tally} disabled={sending} onPick={(mode) => void pick(mode)} />
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}
