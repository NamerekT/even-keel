import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { t } from '../i18n/index.js'
import { chainTo, outsideTo, parentsTo, type FeedView } from '../parents.js'
import { HiddenIcon, OrderIcon, TreeIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import '../stats/overview.css'
import './chain.css'

/**
 * What the project's feed shows: the chain, the parents (BTN-1041; only while the project has some) or the open tasks
 * outside both the chain and the backlog (BTN-1428). While another view is open, a dot on the chain's button says the
 * chain needs the user.
 */
export function FeedSwitch({ view, parents, calls }: { view: FeedView; parents: boolean; calls: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { views } = t.chain
  const dot = view !== 'chain' && calls
  return (
    <div className="segmented feed-switch" role="group" aria-label={views.label}>
      <Item on={view === 'chain'} tip={dot ? `${views.chain}. ${views.calls}` : views.chain} onClick={() => navigate(chainTo(location.search))}>
        <OrderIcon />
        {dot && <span className="feed-switch__dot" aria-hidden="true" />}
      </Item>
      {parents && (
        <Item on={view === 'parents'} tip={views.parents} onClick={() => navigate(parentsTo(location.search))}>
          <TreeIcon />
        </Item>
      )}
      <Item on={view === 'outside'} tip={views.outside} onClick={() => navigate(outsideTo(location.search))}>
        <HiddenIcon />
      </Item>
    </div>
  )
}

function Item({ on, tip, onClick, children }: { on: boolean; tip: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tipped tip={tip} inline>
      <button
        type="button"
        className={on ? 'segmented__item segmented__item--on' : 'segmented__item'}
        aria-label={tip}
        aria-pressed={on}
        onClick={on ? undefined : onClick}
      >
        {children}
      </button>
    </Tipped>
  )
}
