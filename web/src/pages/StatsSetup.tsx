import { useNavigate, useSearchParams } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import type { TallyMode } from '../../../src/stats/mode.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { STATS_SETUP, TallyModes, TallyServerFields } from './TallyChoice.js'

/**
 * The question about stats before the first project: what Tally gives and costs, then where it writes. No stats and the
 * local database are set at once; the user's own Postgres takes a second step with its connection.
 */
export function StatsSetupPage({ state }: { state: EvenKeelState }) {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const server = search.get('step') === 'server'
  const home = () => void navigate('/', { replace: true })

  const pick = async (mode: TallyMode) => {
    if (mode === 'server') return void navigate(`${STATS_SETUP}?step=server`)
    if (await send('stats/tally', { mode })) home()
  }

  return (
    <div className="page accounts-page stats-setup">
      <header className="accounts-page__head">
        <h1 className="page__title">{t.tally.title}</h1>
      </header>
      <ol className="add-steps">
        <li aria-current={!server ? 'step' : undefined}>{server ? `${t.tally.stepStats}: ${t.tally.modes.server}` : t.tally.stepStats}</li>
        <li aria-current={server ? 'step' : undefined}>{t.tally.stepConnection}</li>
      </ol>
      {server ? (
        <section key="server" className="add-window tally-step">
          <p className="queue__hint">{t.tally.modeHints.server}</p>
          <TallyServerFields state={state} onDone={home} onCancel={() => void navigate(STATS_SETUP)} />
        </section>
      ) : (
        <div key="stats" className="tally-step stats-setup__intro">
          <div className="stats-setup__about">
            <img className="stats-setup__preview" src="/stats-preview.png" alt={t.tally.preview} width={1200} height={640} />
            <div className="stats-setup__text">
              <p className="stats-setup__lead">{t.tally.lead}</p>
              <ul className="stats-setup__facts">
                {t.tally.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
          </div>
          <TallyModes chosen={null} current={state.tally} disabled={sending} onPick={(mode) => void pick(mode)} />
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
      )}
    </div>
  )
}
