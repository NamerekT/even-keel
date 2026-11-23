import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useMatch } from 'react-router'
import type { EvenKeelState, MachineCard } from '../../../src/state.js'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { machinePath } from '../machineColor.js'
import { machineCount, machineState, type MachineLamp, type MachineState } from '../machineView.js'
import { HelpChip } from '../pages/HelpPanel.js'
import { projectOfPath } from '../state.js'
import { ServerIcon, SlidersIcon } from '../ui/icons.js'
import { useOpenAddMachine } from './AddMachineDialog.js'
import { useMachineFilter, useMachineStripColor } from './MachineFilter.js'
import { useNow } from './useNow.js'
import './machinePanel.css'

const CLOCK_MS = 30_000
/** As long as `--motion-fast`: the panel's slide out plays before it unmounts. */
const LEAVE_MS = 150
const BLOCK_ATTR = 'data-machine-block'

const colorOf = (card: MachineCard | null): CSSProperties | undefined => (card === null ? undefined : ({ '--machine': card.color } as CSSProperties))

/**
 * The header's machines block (BTN-1051): the count of machines, or the dot of the one whose view the page shows.
 * A machine off the link turns the count into "online/all" with a warning lamp, and the picked one's dot hollow (BTN-1310).
 */
export function MachineBlock() {
  const { cards, shown, selected, open, setOpen } = useMachineFilter()
  if (!shown) return null
  const count = machineCount(cards)
  const label =
    selected !== null ? (selected.online ? t.machinePanel.blockOne(selected.name) : t.machinePanel.blockOneAway(selected.name))
    : count.away.length === 0 ? t.machinePanel.block(cards.length)
    : t.machinePanel.blockAway(count.away.join(', '))
  const classes = ['hblock', 'machine-block', ...(selected === null ? [] : ['machine-block--selected']), ...(selected?.online === false ? ['machine-block--away'] : [])]
  return (
    <button type="button" {...{ [BLOCK_ATTR]: '' }} className={classes.join(' ')} style={colorOf(selected)} aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
      <span className="hblock__seg">
        <ServerIcon />
        {selected !== null ? <span className="machine-block__dot" aria-hidden="true" />
        : <>
            <span className="machine-block__count">{count.text}</span>
            {count.away.length > 0 && <span className="machine-block__warn" aria-hidden="true" />}
          </>}
      </span>
    </button>
  )
}

/** The machine's colour along the header's bottom while its view or its page is shown, fading down into the page. */
export function MachineStrip() {
  const color = useMachineStripColor()
  return color === null ? null : <div className="machine-strip" style={{ '--machine': color } as CSSProperties} aria-hidden="true" />
}

/** The machines panel under the header, over the right column; closed by Escape and a press outside it. */
export function MachinePanel({ state }: { state: EvenKeelState }) {
  const { open, setOpen } = useMachineFilter()
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [open])
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) setOpen(false)
    }
    const onPress = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target === null || panelRef.current?.contains(target) || target.closest(`[${BLOCK_ATTR}]`) !== null || target.closest('dialog') !== null) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open, setOpen])
  if (!mounted) return null
  return (
    <div className="machine-layer">
      <div className="machine-layer__grid">
        <aside ref={panelRef} className={open ? 'machine-panel' : 'machine-panel machine-panel--leaving'} aria-label={t.machinePanel.title}>
          <PanelBody state={state} />
        </aside>
      </div>
    </div>
  )
}

function PanelBody({ state }: { state: EvenKeelState }) {
  const [legend, setLegend] = useState(false)
  return (
    <>
      <header className="machine-panel__head">
        <ServerIcon />
        <h2 className="machine-panel__title">{t.machinePanel.title}</h2>
        <HelpChip open={legend} onToggle={() => setLegend(!legend)} />
      </header>
      <div key={legend ? 'legend' : 'cards'} className="machine-panel__body">
        {legend ? <Legend /> : <Cards state={state} />}
      </div>
    </>
  )
}

function Cards({ state }: { state: EvenKeelState }) {
  const { cards, selected, select } = useMachineFilter()
  const param = useMatch('/p/:id')?.params.id
  const project = param === undefined ? undefined : projectOfPath(state, param).project
  const now = useNow(CLOCK_MS)
  const addMachine = useOpenAddMachine()
  return (
    <ul className="machine-cards">
      <li className={selected === null ? 'machine-card machine-card--selected' : 'machine-card'}>
        <button type="button" className="machine-card__pick" aria-pressed={selected === null} onClick={() => select(null)}>
          <span className="machine-card__name">
            <span className="machine-lamp machine-lamp--all" aria-hidden="true" />
            {t.machinePanel.all}
          </span>
          <span className="machine-card__line">{t.machinePanel.allLine}</span>
        </button>
      </li>
      {cards.map((card) => {
        const view = machineState(state, cards, card, project)
        const classes = ['machine-card', 'machine-card--machine', ...(selected?.id === card.id ? ['machine-card--selected'] : []), ...(view.lamp === 'offline' ? ['machine-card--offline'] : [])]
        return (
          <li key={card.id} className={classes.join(' ')} style={colorOf(card)}>
            <button type="button" className="machine-card__pick" aria-pressed={selected?.id === card.id} onClick={() => select(card.id)}>
              <span className="machine-card__name">
                <span className={`machine-lamp machine-lamp--${view.lamp}`} role="img" aria-label={t.machinePanel.lamps[view.lamp]} />
                {card.name}
              </span>
              <CardLine view={view} now={now} />
            </button>
            <Link to={machinePath(card.id)} className="machine-card__page" aria-label={t.machinePanel.page(card.name)} title={t.machinePanel.page(card.name)}>
              <SlidersIcon />
            </Link>
          </li>
        )
      })}
      <li>
        <button type="button" className="machine-cards__add" onClick={() => addMachine()}>
          {t.machinePanel.add}
        </button>
      </li>
    </ul>
  )
}

/** The card's line under the name: the task, the next one, the limit, the block or how long it is off the link. */
export function CardLine({ view, now }: { view: MachineState; now: Date }) {
  const key = (task: NonNullable<MachineState['task']>) => (
    <>
      <b className="machine-card__key">{task.id}</b>
      {task.title !== null && ` ${task.title}`}
    </>
  )
  if (view.lamp === 'working' && view.task !== undefined) return <span className="machine-card__line">{key(view.task)}</span>
  if (view.lamp === 'free')
    return <span className="machine-card__line">{view.task === undefined ? t.machinePanel.idle : <>{t.machinePanel.next} {key(view.task)}</>}</span>
  if (view.lamp === 'limit') return <span className="machine-card__line">{t.machinePanel.limit(formatMoment(view.until!, now))}</span>
  if (view.lamp === 'blocked') return <span className="machine-card__line machine-card__line--error">{view.reason === 'version' ? t.machinePanel.version(view.version!) : view.reason === 'git' ? t.machinePanel.git : t.machinePanel.packages}</span>
  const since = view.since ?? null
  return <span className="machine-card__line">{since === null ? t.machinePanel.offlineUnknown : t.machinePanel.offline(spanOf(now.getTime() - since))}</span>
}

/** A coarse span: minutes, hours or days. */
export function spanOf(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes} ${t.units.minute}`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} ${t.units.hour}` : `${Math.floor(hours / 24)} ${t.units.day}`
}

const LEGEND: readonly MachineLamp[] = ['working', 'free', 'limit', 'blocked', 'offline']

function Legend() {
  const signs = t.machinePanel.cardSigns
  return (
    <>
      <section className="machine-legend">
        <h3 className="machine-legend__head">{t.machinePanel.lampHead}</h3>
        <ul className="machine-legend__list">
          {LEGEND.map((lamp) => (
            <li key={lamp} className="machine-legend__row">
              <span className="machine-legend__sample"><span className={`machine-lamp machine-lamp--${lamp}`} aria-hidden="true" /></span>
              <span>{t.machinePanel.lamps[lamp]}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="machine-legend">
        <h3 className="machine-legend__head">{t.machinePanel.cardHead}</h3>
        <ul className="machine-legend__list">
          <li className="machine-legend__row"><span className="machine-legend__sample"><span className="machine-legend__stripe" /></span><span>{signs.stripe}</span></li>
          <li className="machine-legend__row"><span className="machine-legend__sample"><span className="machine-legend__frame" /></span><span>{signs.selected}</span></li>
          <li className="machine-legend__row"><span className="machine-legend__sample"><b className="machine-card__key">ABC-7</b></span><span>{signs.next}</span></li>
          <li className="machine-legend__row"><span className="machine-legend__sample"><SlidersIcon /></span><span>{signs.page}</span></li>
          <li className="machine-legend__row"><span className="machine-legend__sample"><span className="machine-lamp machine-lamp--all" /></span><span>{signs.all}</span></li>
        </ul>
      </section>
    </>
  )
}
