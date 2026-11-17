import { useState } from 'react'
import type { ForwardView } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { Fact, FactList } from '../ui/blocks.js'
import { BAR_CELLS, CONFLICT_SHOWN, conflictBar, conflictLinesOf, conflictMax } from './carryConflict.js'
import './carryWait.css'

/**
 * What a carry asked for and not started yet waits to merge (EKR-134): the commits, the conflicted files and their
 * lines, each file with a bar against the largest one. The conflict is known only since the service's start.
 */
export function CarryWait({ forward }: { forward: ForwardView | null }) {
  const [all, setAll] = useState(false)
  const conflict = forward?.conflict ?? null
  const max = conflict === null ? 0 : conflictMax(conflict)
  const shown = conflict === null ? [] : all ? conflict : conflict.slice(0, CONFLICT_SHOWN)
  const hidden = (conflict?.length ?? 0) - shown.length
  return (
    <FactList className="carry-wait">
      <Fact label={t.session.carryWait.commits}>
        <dd className="panel__value">{forward?.behind ?? '—'}</dd>
      </Fact>
      <Fact label={t.session.carryWait.files}>
        <dd className="panel__value">{conflict?.length ?? '—'}</dd>
      </Fact>
      <Fact label={t.session.carryWait.lines}>
        <dd className="panel__value">{conflict === null ? '—' : conflictLinesOf(conflict)}</dd>
      </Fact>
      {shown.length > 0 && (
        <Fact label={t.session.carryWait.conflict} wide>
          <dd>
            <ul className="carry-wait__files">
              {shown.map((file) => (
                <li key={file.path} className="carry-wait__file">
                  <span className="carry-wait__path" title={file.path}>
                    {file.path}
                  </span>
                  {file.lines === null ? (
                    <span className="carry-wait__deleted">{t.session.carryWait.deleted}</span>
                  ) : (
                    <span className="carry-wait__stat" aria-label={t.session.carryWait.lineCount(file.lines)}>
                      <span className="carry-wait__lines">{file.lines}</span>
                      <span className="carry-wait__bar" aria-hidden="true">
                        {Array.from({ length: BAR_CELLS }, (_, cell) => (
                          <span key={cell} className={cell < conflictBar(file.lines, max) ? 'carry-wait__cell carry-wait__cell--on' : 'carry-wait__cell'} />
                        ))}
                      </span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {hidden > 0 && (
              <button type="button" className="button button--small carry-wait__more" onClick={() => setAll(true)}>
                {t.session.carryWait.more(hidden)}
              </button>
            )}
          </dd>
        </Fact>
      )}
    </FactList>
  )
}
