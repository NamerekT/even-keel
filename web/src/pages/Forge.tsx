import { t } from '../i18n/index.js'
import type { BlockLamp } from '../state.js'
import './forge.css'

/** The mark of the fix of a red main in the chain, in place of the number and the lamp: two smiths take turns at an anvil while the session works. */
export function Forge({ lamp }: { lamp: BlockLamp }) {
  return (
    <svg className={`forge forge--${lamp}`} viewBox="0 0 32 22" role="img" aria-label={t.lamp[lamp]}>
      <title>{t.lamp[lamp]}</title>
      <g className="forge__scene">
        <path className="forge__anvil" d="M10.5 16.3h11V18h-4v1.5h2V21h-7v-1.5h2V18h-4z" />
        <rect className="forge__ingot" x="13.4" y="14.4" width="5.2" height="1.9" rx="0.5" />
        <Smith side="left" />
        <g transform="translate(32 0) scale(-1 1)">
          <Smith side="right" />
        </g>
      </g>
      <g className="forge__crossed">
        <Hammer turn={40} />
        <Hammer turn={-40} />
      </g>
    </svg>
  )
}

function Smith({ side }: { side: 'left' | 'right' }) {
  return (
    <g className={`forge__smith forge__smith--${side}`}>
      <circle cx="5" cy="5" r="2" />
      <path className="forge__line" d="M5 7.5v7l-2 6.5M5 14.5l2 6.5" />
      <g transform="translate(5 9)">
        <g className="forge__hammer">
          <path className="forge__line" d="M0 0h8.5" />
          <rect x="8" y="-2.3" width="2.6" height="4.6" rx="0.5" />
        </g>
      </g>
      <path className="forge__spark" d="M14.6 13.6l-0.9-1.6M15.9 13.2v-2M17.2 13.6l0.9-1.6" />
    </g>
  )
}

function Hammer({ turn }: { turn: number }) {
  return (
    <g transform={`translate(16 11) rotate(${turn})`}>
      <path className="forge__line" d="M0 8V-5" />
      <rect x="-4" y="-8.5" width="8" height="3.6" rx="0.6" />
    </g>
  )
}
