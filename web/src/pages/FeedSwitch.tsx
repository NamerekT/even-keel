import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { t } from '../i18n/index.js'
import { chainTo, parentsTo } from '../parents.js'
import { OrderIcon, TreeIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import '../stats/overview.css'
import './chain.css'

/**
 * What the project's feed shows: the chain or the parents (BTN-1041). While the parents are open, a dot on the chain's
 * button says the chain needs the user.
 */
export function FeedSwitch({ parents, calls }: { parents: boolean; calls: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { views } = t.chain
  const dot = parents && calls
  return (
    <div className="segmented feed-switch" role="group" aria-label={views.label}>
      <Item on={!parents} tip={dot ? `${views.chain}. ${views.calls}` : views.chain} onClick={() => navigate(chainTo(location.search))}>
        <OrderIcon />
        {dot && <span className="feed-switch__dot" aria-hidden="true" />}
      </Item>
      <Item on={parents} tip={views.parents} onClick={() => navigate(parentsTo(location.search))}>
        <TreeIcon />
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
