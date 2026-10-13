import { useId, useState } from 'react'
import { t } from '../i18n/index.js'
import type { BlockLamp, ChainBlock } from '../state.js'
import { Lamp } from '../ui/Lamp.js'
import { estimateShare, isRework } from '../ui/look.js'

const LEGEND = ['done', 'working', 'waiting', 'handoff', 'stopped', 'error', 'ahead', 'backlog', 'canceled'] as const satisfies readonly BlockLamp[]
const SHAPES = ['urgent', 'high', 'low', 'rework', 'family', 'estimate'] as const
type Shape = (typeof SHAPES)[number]

interface Props {
  blocks: ChainBlock[]
  families: boolean
  locked: boolean
  movable: boolean
}

/** The lamps are always in sight; the shapes and the hints are needed once, so they wait behind the "?". */
export function ChainLegend({ blocks, families, locked, movable }: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const shapes = SHAPES.filter((shape) => shapeShown(shape, blocks, families))

  return (
    <div className="chain__help">
      <ul className="chain__legend">
        {LEGEND.map((lamp) => (
          <li key={lamp} className="chain__legend-item">
            <Lamp lamp={lamp} />
            {t.chain.legend[lamp]}
          </li>
        ))}
        <li className="chain__legend-item">
          <button
            type="button"
            className="chain__help-toggle"
            aria-expanded={open}
            aria-controls={id}
            aria-label={t.chain.help}
            title={t.chain.help}
            onClick={() => setOpen(!open)}
          >
            ?
          </button>
        </li>
      </ul>
      {open && (
        <div id={id} className="chain__help-body">
          {shapes.length > 0 && (
            <ul className="chain__legend">
              {shapes.map((shape) => (
                <li key={shape} className="chain__legend-item">
                  <span className={`chain__shape chain__shape--${shape}`} aria-hidden="true" />
                  {t.chain.shapes[shape]}
                </li>
              ))}
            </ul>
          )}
          <p className="chain__hint">{t.chain.linksHint}</p>
          {locked && <p className="chain__hint">{t.chain.lockedHint}</p>}
          {movable && <p className="chain__hint">{t.chain.dragHint}</p>}
        </div>
      )}
    </div>
  )
}

function shapeShown(shape: Shape, blocks: ChainBlock[], families: boolean): boolean {
  const ahead = blocks.filter((block) => block.lamp !== 'done' && block.lamp !== 'canceled')
  if (shape === 'family') return families
  if (shape === 'rework') return ahead.some((block) => isRework(block.labels))
  if (shape === 'estimate') return ahead.some((block) => estimateShare(block.estimate) !== null)
  return ahead.some((block) => block.priority === shape)
}
