import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import type { ContextScale } from '../../../src/state.js'
import { useCommand } from '../live/useCommand.js'
import type { BlockLamp, ChainBlock } from '../state.js'
import { ARCHIVE_PAGE, archiveView } from '../ui/archive.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Lamp } from '../ui/Lamp.js'
import { blockLinks, type Point } from '../ui/reorder.js'
import { arrowPath, linkPath, snakeCell, snakeColumns, snakeStep } from '../ui/snake.js'
import { useSnakeDrag, type SnakeDrag } from './useSnakeDrag.js'

const BLOCK_MIN = 200
const GAP = 40
const ROW_GAP = 36
const LANES = 4
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

interface Arrow {
  d: string
  strong: boolean
}

export function ChainSnake({ project, chain, scale, focus }: Props) {
  const [pages, setPages] = useState(0)
  const { send, sending, failure } = useCommand()
  const [pending, setPending] = useState<string[] | null>(null)
  const served = openIds(chain).join(',')
  useEffect(() => setPending(null), [served])

  const archive = archiveView(pending === null ? chain : withOrder(chain, pending), pages, focus)
  const blocks = archive.visible
  const listRef = useRef<HTMLOListElement>(null)
  const [width, setWidth] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [links, setLinks] = useState<string[]>([])
  const columns = snakeColumns(width, BLOCK_MIN, GAP)
  const cells = blocks.map((_, index) => snakeCell(index, columns))
  const layout = `${columns}:${blocks.map((block) => `${block.id}${block.open ? '' : '!'}<${block.blockedBy.join('+')}@${block.milestone ?? ''}`).join(',')}`

  const { drag, landing, movable } = useSnakeDrag({
    listRef,
    blocks,
    disabled: sending,
    onDrop: (order) => {
      setPending(order)
      void send('chain/order', { project, order }).then((ok) => ok || setPending(null))
    },
  })

  const measure = useCallback(() => {
    const list = listRef.current
    if (list === null) return
    setWidth(list.clientWidth)
    setSize({ width: list.clientWidth, height: list.clientHeight })
    const items = [...list.children].filter((child): child is HTMLElement => child instanceof HTMLLIElement)
    const boxes = items.map((item) => ({
      left: item.offsetLeft,
      top: item.offsetTop,
      width: item.offsetWidth,
      height: item.offsetHeight,
    }))
    const first = blocks.findIndex((block) => block.open)
    const found = first < 0 ? [] : blockLinks(openIds(blocks), blockersOf(blocks))
    const strong = new Set(found.filter((link) => link.adjacent).map((link) => link.from + first))
    setArrows(
      boxes.slice(1).map((box, index) => ({
        d: arrowPath(boxes[index]!, box, snakeStep(cells[index]!, cells[index + 1]!)),
        strong: strong.has(index),
      })),
    )
    setLinks(
      found
        .filter((link) => !link.adjacent)
        .map((link, lane) => {
          const from = link.from + first
          return linkPath(boxes[from]!, boxes[link.to + first]!, {
            gap: ROW_GAP,
            side: cells[from]!.row === 0 ? 'below' : 'above',
            lane: lane % LANES,
          })
        }),
    )
  }, [layout])

  useLayoutEffect(() => {
    measure()
    const list = listRef.current
    if (list === null) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(list)
    for (const item of list.children) observer.observe(item)
    return () => observer.disconnect()
  }, [measure])

  return (
    <div className="snake">
      {archive.hidden > 0 && (
        <button
          type="button"
          className="button snake__archive"
          onClick={() => setPages(Math.ceil(archive.shown / ARCHIVE_PAGE) + 1)}
        >
          {archive.shown === 0 ? `Архив (${archive.hidden})` : `Загрузить ещё (${archive.next}/${archive.hidden})`}
        </button>
      )}
      <ol
        ref={listRef}
        className={listClass(drag !== null, landing !== null)}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP, rowGap: ROW_GAP }}
      >
        {blocks.map((block, index) => (
          <Block
            key={block.id}
            block={block}
            scale={scale}
            focused={block.id === focus}
            movable={movable(block)}
            drag={drag}
            offset={landing?.id === block.id ? landing.offset : drag?.offsets.get(block.id)}
            row={cells[index]!.row}
            column={cells[index]!.column}
            onReturn={sending ? undefined : () => void send('chain/unskip', { project, task: block.id })}
          />
        ))}
      </ol>
      <svg
        className={drag === null ? 'snake__arrows' : 'snake__arrows snake__arrows--hidden'}
        width={size.width}
        height={size.height}
        aria-hidden="true"
      >
        <defs>
          <marker id="snake-head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path className="snake__head" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
          <marker
            id="snake-head-strong"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="11"
            markerHeight="11"
            orient="auto"
          >
            <path className="snake__head snake__head--strong" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {arrows.map((arrow, index) => (
          <path
            key={index}
            className={arrow.strong ? 'snake__arrow snake__arrow--strong' : 'snake__arrow'}
            d={arrow.d}
            markerEnd={arrow.strong ? 'url(#snake-head-strong)' : 'url(#snake-head)'}
          />
        ))}
        {links.map((d, index) => (
          <path key={`link-${index}`} className="snake__arrow snake__arrow--strong" d={d} markerEnd="url(#snake-head-strong)" />
        ))}
      </svg>
      {failure !== null && <p className="notice notice--error">{failure}</p>}
      <ul className="snake__legend">
        {LEGEND.map(([lamp, label]) => (
          <li key={lamp} className="snake__legend-item">
            <Lamp lamp={lamp} />
            {label}
          </li>
        ))}
        <li className="snake__legend-item">
          <span className="snake__legend-link" aria-hidden="true" />
          блокирует
        </li>
      </ul>
      {blocks.some((block) => movable(block)) && (
        <p className="snake__hint">Порядок меняется перетаскиванием карточки, на телефоне — после долгого нажатия.</p>
      )}
    </div>
  )
}

interface BlockProps {
  block: ChainBlock
  scale: ContextScale
  focused: boolean
  movable: boolean
  drag: SnakeDrag | null
  offset: Point | undefined
  row: number
  column: number
  onReturn: (() => void) | undefined
}

function Block({ block, scale, focused, movable, drag, offset, row, column, onReturn }: BlockProps) {
  const classes = ['block', `block--${block.lamp}`]
  if (block.current) classes.push('block--current')
  if (block.skipped) classes.push('block--skipped')
  if (focused) classes.push('block--focus')
  if (movable) classes.push('block--movable')
  const role = dragRole(drag, block.id)
  if (role !== null) classes.push(`block--${role}`)
  const style: CSSProperties = { gridRow: row + 1, gridColumn: column + 1 }
  if (offset !== undefined) style.transform = `translate(${offset.x}px, ${offset.y}px)`

  return (
    <li
      id={block.id}
      className={classes.join(' ')}
      style={style}
      data-block={block.id}
      data-movable={movable || undefined}
    >
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
        {block.current && <span className="block__badge">сейчас</span>}
        {block.skipped && <span className="block__badge block__badge--skipped">пропущена</span>}
        {role === 'blocker' && <span className="block__badge block__badge--blocker">блокирует</span>}
        {role === 'dependent' && <span className="block__badge block__badge--dependent">ждёт её</span>}
      </div>
      {block.title !== null && <p className="block__title">{block.title}</p>}
      {block.milestone !== null && (
        <p className="block__milestone" title={block.milestone}>
          {block.milestone}
        </p>
      )}
      {block.status !== null && <p className="block__status">{block.status}</p>}
      {block.current && block.session !== null && <ContextMeter tokens={block.session.contextTokens} scale={scale} />}
      {block.skipped && (
        <button type="button" className="button block__return" disabled={onReturn === undefined} onClick={onReturn}>
          Вернуть
        </button>
      )}
    </li>
  )
}

function dragRole(drag: SnakeDrag | null, id: string): 'dragged' | 'blocker' | 'dependent' | null {
  if (drag === null) return null
  if (drag.id === id) return 'dragged'
  if (drag.blockers.has(id)) return 'blocker'
  return drag.dependents.has(id) ? 'dependent' : null
}

function openIds(blocks: ChainBlock[]): string[] {
  return blocks.filter((block) => block.open).map((block) => block.id)
}

function blockersOf(blocks: ChainBlock[]): Map<string, string[]> {
  return new Map(blocks.map((block) => [block.id, block.blockedBy]))
}

function withOrder(chain: ChainBlock[], order: string[]): ChainBlock[] {
  const byId = new Map(chain.map((block) => [block.id, block]))
  const open = order.flatMap((id) => byId.get(id) ?? [])
  if (open.length !== openIds(chain).length) return chain
  return [...chain.filter((block) => !block.open), ...open]
}

function listClass(dragging: boolean, landing: boolean): string {
  if (dragging) return 'snake__list snake__list--dragging'
  return landing ? 'snake__list snake__list--landing' : 'snake__list'
}
