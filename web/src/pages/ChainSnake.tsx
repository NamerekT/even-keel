import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { ContextScale } from '../../../src/state.js'
import type { BlockLamp, ChainBlock } from '../state.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Lamp } from '../ui/Lamp.js'
import { arrowPath, snakeCell, snakeColumns, snakeStep } from '../ui/snake.js'

const BLOCK_MIN = 200
const GAP = 40
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
  blocks: ChainBlock[]
  scale: ContextScale
  focus: string
}

export function ChainSnake({ blocks, scale, focus }: Props) {
  const listRef = useRef<HTMLOListElement>(null)
  const [width, setWidth] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [paths, setPaths] = useState<string[]>([])
  const columns = snakeColumns(width, BLOCK_MIN, GAP)
  const cells = blocks.map((_, index) => snakeCell(index, columns))
  const layout = `${columns}:${blocks.map((block) => block.id).join(',')}`

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
    setPaths(
      boxes.slice(1).map((box, index) => arrowPath(boxes[index]!, box, snakeStep(cells[index]!, cells[index + 1]!))),
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
      <ol
        ref={listRef}
        className="snake__list"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP }}
      >
        {blocks.map((block, index) => (
          <Block
            key={block.id}
            block={block}
            scale={scale}
            focused={block.id === focus}
            row={cells[index]!.row}
            column={cells[index]!.column}
          />
        ))}
      </ol>
      <svg className="snake__arrows" width={size.width} height={size.height} aria-hidden="true">
        <defs>
          <marker id="snake-head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path className="snake__head" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {paths.map((path, index) => (
          <path key={index} className="snake__arrow" d={path} markerEnd="url(#snake-head)" />
        ))}
      </svg>
      <ul className="snake__legend">
        {LEGEND.map(([lamp, label]) => (
          <li key={lamp} className="snake__legend-item">
            <Lamp lamp={lamp} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface BlockProps {
  block: ChainBlock
  scale: ContextScale
  focused: boolean
  row: number
  column: number
}

function Block({ block, scale, focused, row, column }: BlockProps) {
  const classes = ['block', `block--${block.lamp}`]
  if (block.current) classes.push('block--current')
  if (focused) classes.push('block--focus')

  return (
    <li id={block.id} className={classes.join(' ')} style={{ gridRow: row + 1, gridColumn: column + 1 }}>
      <div className="block__head">
        <Lamp lamp={block.lamp} />
        <Link to={{ hash: block.id }} className="block__key" aria-current={focused ? 'true' : undefined}>
          {block.id}
        </Link>
        {block.current && <span className="block__badge">сейчас</span>}
      </div>
      {block.title !== null && <p className="block__title">{block.title}</p>}
      {block.status !== null && <p className="block__status">{block.status}</p>}
      {block.current && block.session !== null && <ContextMeter tokens={block.session.contextTokens} scale={scale} />}
    </li>
  )
}
