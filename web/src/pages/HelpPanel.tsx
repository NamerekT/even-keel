import { useEffect, useRef, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { Ring } from '../layout/AccountBlock.js'
import { BurgerIcon } from '../layout/Menu.js'
import { GearIcon } from '../layout/Status.js'
import { isClosedLamp, type BlockLamp, type ChainBlock } from '../state.js'
import { SectionLabel } from '../ui/blocks.js'
import { QuestionIcon, QueueIcon, RefreshIcon, SlidersIcon, StackIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { estimateShare, isRework, railsOf } from '../ui/look.js'
import { seriesStyle } from '../ui/series.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { reorderable } from './useChainDrag.js'
import './pageHelp.css'

/** The address hash that opens the help panel; a task id never equals it. */
export const HELP_HASH = 'help'

const LEGEND = ['done', 'working', 'waiting', 'handoff', 'stopped', 'error', 'ahead', 'backlog', 'canceled'] as const satisfies readonly BlockLamp[]
type LegendLamp = (typeof LEGEND)[number] | 'fixed'
const SHAPES = ['urgent', 'high', 'low', 'rework', 'family', 'estimate'] as const
type Shape = (typeof SHAPES)[number]

/** Only the "?", a narrow tab: the help is a reference, not a section of the page like Backlog and Settings. */
const HELP_CLASS: Record<ChipLook, string> = { tag: 'tag tag--help', tab: 'side-tab side-tab--help', seg: SEG_CLASS }

export function HelpChip({ open, look = 'tag', onToggle }: { open: boolean; look?: ChipLook; onToggle: () => void }) {
  return (
    <button type="button" className={HELP_CLASS[look]} aria-expanded={open} aria-label={t.help.title} title={t.help.title} onClick={onToggle}>
      ?
    </button>
  )
}

interface Props {
  blocks: ChainBlock[]
  /** The project has a CI: its badge is in the head. */
  ci: boolean
  /** The header is the narrow one, and Backlog and Settings show only their icons. */
  narrow: boolean
  onClose: () => void
}

/** The marks of the chain and the signs of the head whose meaning is not written on them; a hint only where the chain has its case. */
export function HelpPanel({ blocks, ci, narrow, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const shapes = SHAPES.filter((shape) => shapeShown(shape, blocks))
  const lamps: readonly LegendLamp[] = blocks.some((block) => block.lamp === 'fixed') ? [...LEGEND, 'fixed'] : LEGEND

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel page-help" aria-label={t.help.title}>
      <header className="panel__head">
        <h2 className="panel__task">{t.help.title}</h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      <section className="page-help__section">
        <SectionLabel>{t.help.chain}</SectionLabel>
        <ul className="page-help__marks">
          {lamps.map((lamp) => (
            <li key={lamp} className="page-help__mark">
              <Lamp lamp={lamp} />
              {t.chain.legend[lamp]}
            </li>
          ))}
        </ul>
        {shapes.length > 0 && (
          <ul className="page-help__marks">
            {shapes.map((shape) => (
              <li key={shape} className="page-help__mark">
                <span className={`page-help__shape page-help__shape--${shape}`} aria-hidden="true" />
                {t.chain.shapes[shape]}
              </li>
            ))}
          </ul>
        )}
        <ul className="page-help__hints">
          <li>{t.help.open}</li>
          <li>{t.chain.linksHint}</li>
          {blocks.some((block) => block.locked) && <li>{t.chain.lockedHint}</li>}
          {blocks.some(reorderable) && <li>{t.chain.dragHint}</li>}
        </ul>
      </section>
      <section className="page-help__section">
        <SectionLabel>{t.help.head}</SectionLabel>
        <ul className="page-help__signs">
          {narrow ? <NarrowHeader /> : <WideHeader />}
          <Sign sample={<QuestionIcon />}>{t.help.signs.questions}</Sign>
          <Sign sample={<RefreshIcon />}>{t.help.signs.read}</Sign>
          {ci && (
            <Sign
              sample={
                <span className="ci--success">
                  <span className="ci-dot" />
                </span>
              }
            >
              {t.help.signs.ci}
            </Sign>
          )}
          {narrow && <Sign sample={<StackIcon />}>{t.help.signs.backlog}</Sign>}
          {narrow && <Sign sample={<SlidersIcon />}>{t.help.signs.settings}</Sign>}
        </ul>
      </section>
    </aside>
  )
}

/** The header of the wide page: the queue, the account with its limits, the other accounts and the gear. */
function WideHeader() {
  return (
    <>
      <Sign sample={<QueueIcon />}>{t.help.signs.queue}</Sign>
      <Sign
        sample={
          <span className="account-toggle--in" style={seriesStyle(1)}>
            <span className="queue-toggle__dot" />
          </span>
        }
      >
        {t.help.signs.account}
      </Sign>
      <Sign
        sample={
          <span className="limit--warm">
            <Ring percent={85} />
          </span>
        }
      >
        {t.help.signs.limit}
      </Sign>
      <Sign
        sample={
          <span className="account-block__mini" style={seriesStyle(2)}>
            <Ring percent={40} />
          </span>
        }
      >
        {t.help.signs.others}
      </Sign>
      <Sign sample={<GearIcon />}>{t.help.signs.gear}</Sign>
    </>
  )
}

/** The header of the narrow page: the count of sessions waiting, the menu and the limits as bars along its bottom. */
function NarrowHeader() {
  return (
    <>
      <Sign sample={<span className="waiting__count">2</span>}>{t.help.signs.waiting}</Sign>
      <Sign sample={<BurgerIcon />}>{t.help.signs.menu}</Sign>
      <Sign sample={<span className="page-help__bars" />}>{t.help.signs.bars}</Sign>
    </>
  )
}

function Sign({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li className="page-help__sign">
      <span className="page-help__sample" aria-hidden="true">
        {sample}
      </span>
      <span>{children}</span>
    </li>
  )
}

function shapeShown(shape: Shape, blocks: ChainBlock[]): boolean {
  const ahead = blocks.filter((block) => !isClosedLamp(block.lamp))
  if (shape === 'family') return railsOf(blocks).size > 0
  if (shape === 'rework') return ahead.some((block) => isRework(block.labels))
  if (shape === 'estimate') return ahead.some((block) => estimateShare(block.estimate) !== null)
  return ahead.some((block) => block.priority === shape)
}
