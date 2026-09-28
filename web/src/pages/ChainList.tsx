import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import type { ContextScale } from '../../../src/state.js'
import { plural } from '../format.js'
import { useCommand } from '../live/useCommand.js'
import type { BlockLamp, ChainBlock } from '../state.js'
import { ARCHIVE_PAGE, archiveView } from '../ui/archive.js'
import { CacheClock } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Lamp } from '../ui/Lamp.js'
import { milestoneView, type Section } from '../ui/milestones.js'
import { railLanes, railPath, type RailLink } from '../ui/rail.js'
import { blockLinks, type Point } from '../ui/reorder.js'
import { useChainDrag, type ChainDrag } from './useChainDrag.js'

const LANE = 12
const LANES = 4
const RAIL_PAD = 20
const STUB = 6
const LEGEND: [BlockLamp, string][] = [
  ['done', 'готово'],
  ['working', 'в работе'],
  ['waiting', 'ждёт ответа'],
  ['stopped', 'сессия остановилась'],
  ['error', 'ошибка или лимит'],
  ['ahead', 'впереди'],
  ['canceled', 'отменена'],
]

interface Props {
  project: string
  chain: ChainBlock[]
  scale: ContextScale
  focus: string
}

interface Rail {
  d: string
  strong: boolean
}

export function ChainList({ project, chain, scale, focus }: Props) {
  const [pages, setPages] = useState(0)
  const [revealed, setRevealed] = useState(0)
  const { send, sending, failure } = useCommand()
  const location = useLocation()
  const navigate = useNavigate()
  const [pending, setPending] = useState<string[] | null>(null)
  const served = openIds(chain).join(',')
  useEffect(() => setPending(null), [served])

  const ordered = pending === null ? chain : withOrder(chain, pending)
  const archive = archiveView(ordered, pages, focus)
  const view = milestoneView(archive.visible, revealed, focus)
  const blocks = view.sections.flatMap((section) => section.blocks)
  const shown = new Set(blocks.map((block) => block.id))
  const hidden = openIds(ordered).filter((id) => !shown.has(id))
  const open = new Set(openIds(ordered))
  const numbers = new Map(openIds(blocks).map((id, index) => [id, index + 1]))
  const lanes = rails(blocks)
  const width = RAIL_PAD + Math.min(LANES, Math.max(0, ...lanes.map((link) => link.lane + 1))) * LANE

  const listRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [paths, setPaths] = useState<Rail[]>([])
  const layout = `${width}:${focus}:${blocks.map((block) => `${block.id}${block.open ? '' : '!'}<${block.blockedBy.join('+')}`).join(',')}`

  const unfocus = (kept: ChainBlock[]) => {
    if (focus !== '' && !kept.some((block) => block.id === focus)) navigate({ search: location.search, hash: '' })
  }
  const collapseArchive = () => {
    setPages(0)
    unfocus(archiveView(ordered, 0, '').visible)
  }
  const collapseMilestones = () => {
    setRevealed(0)
    unfocus(milestoneView(archive.visible, 0).sections.flatMap((section) => section.blocks))
  }

  const { drag, landing, movable } = useChainDrag({
    listRef,
    blocks,
    disabled: sending,
    onDrop: (order) => {
      const full = [...order, ...hidden]
      setPending(full)
      void send('chain/order', { project, order: full }).then((ok) => ok || setPending(null))
    },
  })

  const measure = useCallback(() => {
    const list = listRef.current
    if (list === null) return
    const rect = list.getBoundingClientRect()
    setSize({ width: list.clientWidth, height: list.clientHeight })
    const items = [...list.querySelectorAll<HTMLElement>('[data-block]')]
    const rows = items.map((item) => {
      const box = item.getBoundingClientRect()
      return { x: box.left - rect.left, y: box.top - rect.top + box.height / 2 }
    })
    const focused = blocks.findIndex((block) => block.id === focus)
    setPaths(
      lanes.flatMap((link) => {
        const x = width - RAIL_PAD / 2 - (link.lane % LANES) * LANE
        const from: Point = { x: rows[link.from]!.x, y: rows[link.from]!.y + STUB }
        return link.to.map((to) => ({
          d: railPath(from, { x: rows[to]!.x, y: rows[to]!.y - STUB }, x),
          strong: link.from === focused || to === focused,
        }))
      }),
    )
  }, [layout])

  useLayoutEffect(() => {
    measure()
    const list = listRef.current
    if (list === null) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(list)
    for (const item of list.querySelectorAll('[data-block]')) observer.observe(item)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div className="chain" style={{ '--rail': `${width}px` } as CSSProperties}>
      {(archive.hidden > 0 || archive.shown > 0) && (
        <div className="chain__buttons">
          {archive.hidden > 0 && (
            <button type="button" className="button" onClick={() => setPages(Math.ceil(archive.shown / ARCHIVE_PAGE) + 1)}>
              {archive.shown === 0 ? `Архив (${archive.hidden})` : `Загрузить ещё (${archive.next}/${archive.hidden})`}
            </button>
          )}
          {archive.shown > 0 && (
            <button type="button" className="button" onClick={collapseArchive}>
              Свернуть архив
            </button>
          )}
        </div>
      )}
      <div ref={listRef} className={listClass(drag !== null, landing !== null)}>
        {view.sections.map((section, index) => (
          <section key={`${index}:${section.milestone}`} className="chain__section">
            {view.titled && <Milestone section={section} />}
            <ol className="chain__blocks">
              {section.blocks.map((block) => (
                <Block
                  key={block.id}
                  block={block}
                  number={numbers.get(block.id)}
                  waits={block.blockedBy.filter((id) => open.has(id))}
                  scale={scale}
                  focused={block.id === focus}
                  movable={movable(block)}
                  drag={drag}
                  offset={landing?.id === block.id ? landing.offset : drag?.offsets.get(block.id)}
                  onReturn={sending ? undefined : () => void send('chain/unskip', { project, task: block.id })}
                />
              ))}
            </ol>
          </section>
        ))}
        <svg
          className={drag === null ? 'chain__rail' : 'chain__rail chain__rail--hidden'}
          width={size.width}
          height={size.height}
          aria-hidden="true"
        >
          <defs>
            <marker id="rail-head" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto">
              <path className="chain__head" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            <marker id="rail-head-strong" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
              <path className="chain__head chain__head--strong" d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          </defs>
          {paths.map((path, index) => (
            <path
              key={index}
              className={path.strong ? 'chain__link chain__link--strong' : 'chain__link'}
              d={path.d}
              markerEnd={path.strong ? 'url(#rail-head-strong)' : 'url(#rail-head)'}
            />
          ))}
        </svg>
      </div>
      {(view.next !== null || view.revealed > 0) && (
        <div className="chain__next">
          {view.next !== null && <Milestone section={view.next} hidden />}
          <div className="chain__buttons">
            {view.next !== null && (
              <button type="button" className="button chain__reveal" onClick={() => setRevealed(view.revealed + 1)}>
                Загрузить следующую веху
              </button>
            )}
            {view.revealed > 0 && (
              <button type="button" className="button" onClick={collapseMilestones}>
                Свернуть вехи
              </button>
            )}
          </div>
        </div>
      )}
      {failure !== null && <p className="notice notice--error">{failure}</p>}
      <ul className="chain__legend">
        {LEGEND.map(([lamp, label]) => (
          <li key={lamp} className="chain__legend-item">
            <Lamp lamp={lamp} />
            {label}
          </li>
        ))}
        <li className="chain__legend-item">
          <span className="chain__legend-link" aria-hidden="true" />
          блокирует
        </li>
      </ul>
      {blocks.some((block) => movable(block)) && (
        <p className="chain__hint">Порядок меняется перетаскиванием карточки, на телефоне — после долгого нажатия.</p>
      )}
    </div>
  )
}

function Milestone({ section, hidden = false }: { section: Section<ChainBlock>; hidden?: boolean }) {
  const count = section.blocks.length
  const tasks = `${count} ${plural(count, 'задача', 'задачи', 'задач')}`
  return (
    <h2 className={hidden ? 'chain__milestone chain__milestone--hidden' : 'chain__milestone'}>
      <span className="chain__milestone-name">{section.milestone ?? 'Без вехи'}</span>
      <span className="chain__milestone-line" aria-hidden="true" />
      <span className="chain__milestone-count">{hidden ? `скрыта · ${tasks}` : tasks}</span>
    </h2>
  )
}

interface BlockProps {
  block: ChainBlock
  number: number | undefined
  waits: string[]
  scale: ContextScale
  focused: boolean
  movable: boolean
  drag: ChainDrag | null
  offset: Point | undefined
  onReturn: (() => void) | undefined
}

function Block({ block, number, waits, scale, focused, movable, drag, offset, onReturn }: BlockProps) {
  const classes = ['block', `block--${block.lamp}`]
  if (block.current) classes.push('block--current')
  if (block.skipped) classes.push('block--skipped')
  if (focused) classes.push('block--focus')
  if (movable) classes.push('block--movable')
  const role = dragRole(drag, block.id)
  if (role !== null) classes.push(`block--${role}`)
  const style: CSSProperties = {}
  if (offset !== undefined) style.transform = `translate(${offset.x}px, ${offset.y}px)`

  return (
    <li
      id={block.id}
      className={classes.join(' ')}
      style={style}
      data-block={block.id}
      data-movable={movable || undefined}
    >
      <span className="block__number">{number}</span>
      <div className="block__head">
        <Lamp lamp={block.lamp} />
        <Link
          to={{ hash: block.id }}
          className="block__key"
          draggable={false}
          aria-current={focused ? 'true' : undefined}
        >
          {block.id}
        </Link>
      </div>
      <p className="block__title">{block.title}</p>
      <div className="block__side">
        {block.current && <span className="block__badge">сейчас</span>}
        {block.skipped && <span className="block__badge block__badge--skipped">пропущена</span>}
        {block.question && (
          <span className="block__badge block__badge--question" title="Ярлык «Вопрос»: без ответа в описании сессия, скорее всего, встанет">
            вопрос
          </span>
        )}
        {role === 'blocker' && <span className="block__badge block__badge--blocker">блокирует</span>}
        {role === 'dependent' && <span className="block__badge block__badge--dependent">ждёт её</span>}
        {waits.length > 0 && <span className="block__waits">ждёт {waits.join(', ')}</span>}
        {block.status !== null && <span className="block__status">{block.status}</span>}
        {block.current && block.session !== null && block.session.cache !== null && <CacheClock cache={block.session.cache} />}
        {block.current && block.session !== null && <ContextMeter tokens={block.session.contextTokens} scale={scale} />}
        {block.skipped && (
          <button type="button" className="button block__return" disabled={onReturn === undefined} onClick={onReturn}>
            Вернуть
          </button>
        )}
      </div>
    </li>
  )
}

function rails(blocks: ChainBlock[]): RailLink[] {
  const first = blocks.findIndex((block) => block.open)
  if (first < 0) return []
  const links = blockLinks(openIds(blocks), new Map(blocks.map((block) => [block.id, block.blockedBy])))
  return railLanes(links.map((link) => ({ from: link.from + first, to: link.to + first })))
}

function dragRole(drag: ChainDrag | null, id: string): 'dragged' | 'blocker' | 'dependent' | null {
  if (drag === null) return null
  if (drag.id === id) return 'dragged'
  if (drag.blockers.has(id)) return 'blocker'
  return drag.dependents.has(id) ? 'dependent' : null
}

function openIds(blocks: ChainBlock[]): string[] {
  return blocks.filter((block) => block.open).map((block) => block.id)
}

function withOrder(chain: ChainBlock[], order: string[]): ChainBlock[] {
  const byId = new Map(chain.map((block) => [block.id, block]))
  const open = order.flatMap((id) => byId.get(id) ?? [])
  if (open.length !== openIds(chain).length) return chain
  return [...chain.filter((block) => !block.open), ...open]
}

function listClass(dragging: boolean, landing: boolean): string {
  if (dragging) return 'chain__list chain__list--dragging'
  return landing ? 'chain__list chain__list--landing' : 'chain__list'
}
