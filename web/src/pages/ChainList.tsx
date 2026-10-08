import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { withWaiting } from '../../../src/chain/order.js'
import type { ContextScale, TrackerUrls } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { checkpointHandoffs, issueLink, type BlockLamp, type ChainBlock } from '../state.js'
import { ARCHIVE_PAGE, archiveView } from '../ui/archive.js'
import { CacheClock } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { Lamp } from '../ui/Lamp.js'
import { milestoneView, type Section } from '../ui/milestones.js'
import { relatives, type Point } from '../ui/reorder.js'
import { useChainDrag, type ChainDrag } from './useChainDrag.js'

const LEGEND = ['done', 'working', 'waiting', 'stopped', 'error', 'ahead', 'canceled'] as const satisfies readonly BlockLamp[]

interface Props {
  project: string
  chain: ChainBlock[]
  scale: ContextScale
  trackerUrls: TrackerUrls
  focus: string
  onCard: (task: string) => void
}

interface Relatives {
  blockers: ReadonlySet<string>
  dependents: ReadonlySet<string>
}

interface Relation {
  role: 'dragged' | 'blocker' | 'dependent'
  badge: boolean
}

export function ChainList({ project, chain, scale, trackerUrls, focus, onCard }: Props) {
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
  const open = new Set(linkedIds(ordered))
  const numbers = new Map(openIds(blocks).map((id, index) => [id, index + 1]))
  const [hovered, setHovered] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  const selected = relativesOf(blocks, focus)
  const pointed = relativesOf(blocks, hovered)

  return (
    <div className="chain">
      {(archive.hidden > 0 || archive.shown > 0) && (
        <div className="chain__buttons">
          {archive.hidden > 0 && (
            <button type="button" className="button" onClick={() => setPages(Math.ceil(archive.shown / ARCHIVE_PAGE) + 1)}>
              {archive.shown === 0 ? t.chain.archive(archive.hidden) : t.chain.loadMore(archive.next, archive.hidden)}
            </button>
          )}
          {archive.shown > 0 && (
            <button type="button" className="button" onClick={collapseArchive}>
              {t.chain.foldArchive}
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
                  link={block.locked ? issueLink(trackerUrls, block.id) : null}
                  number={numbers.get(block.id)}
                  waits={block.blockedBy.filter((id) => open.has(id))}
                  scale={scale}
                  focused={block.id === focus}
                  movable={movable(block)}
                  relation={relationOf(block.id, drag, selected, pointed)}
                  offset={landing?.id === block.id ? landing.offset : drag?.offsets.get(block.id)}
                  onHover={(inside) => setHovered((current) => (inside ? block.id : current === block.id ? null : current))}
                  onReturn={sending ? undefined : () => void send('chain/unskip', { project, task: block.id })}
                  onCard={() => onCard(block.id)}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
      {(view.next !== null || view.revealed > 0) && (
        <div className="chain__next">
          {view.next !== null && <Milestone section={view.next} hidden />}
          <div className="chain__buttons">
            {view.next !== null && (
              <button type="button" className="button chain__reveal" onClick={() => setRevealed(view.revealed + 1)}>
                {t.chain.nextMilestone}
              </button>
            )}
            {view.revealed > 0 && (
              <button type="button" className="button" onClick={collapseMilestones}>
                {t.chain.foldMilestones}
              </button>
            )}
          </div>
        </div>
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <ul className="chain__legend">
        {LEGEND.map((lamp) => (
          <li key={lamp} className="chain__legend-item">
            <Lamp lamp={lamp} />
            {t.chain.legend[lamp]}
          </li>
        ))}
      </ul>
      <p className="chain__hint">{t.chain.linksHint}</p>
      {blocks.some((block) => block.locked) && <p className="chain__hint">{t.chain.lockedHint}</p>}
      {blocks.some((block) => movable(block)) && <p className="chain__hint">{t.chain.dragHint}</p>}
    </div>
  )
}

function Milestone({ section, hidden = false }: { section: Section<ChainBlock>; hidden?: boolean }) {
  const tasks = t.chain.tasks(section.blocks.filter((block) => !block.locked).length)
  return (
    <h2 className={hidden ? 'chain__milestone chain__milestone--hidden' : 'chain__milestone'}>
      <span className="chain__milestone-name">{section.milestone ?? t.chain.noMilestone}</span>
      <span className="chain__milestone-line" aria-hidden="true" />
      <span className="chain__milestone-count">{hidden ? t.chain.hidden(tasks) : tasks}</span>
    </h2>
  )
}

interface BlockProps {
  block: ChainBlock
  link: string | null
  number: number | undefined
  waits: string[]
  scale: ContextScale
  focused: boolean
  movable: boolean
  relation: Relation | null
  offset: Point | undefined
  onHover: (inside: boolean) => void
  onReturn: (() => void) | undefined
  onCard: () => void
}

function Block({ block, link, number, waits, scale, focused, movable, relation, offset, onHover, onReturn, onCard }: BlockProps) {
  const classes = ['block', `block--${block.lamp}`]
  if (block.current) classes.push('block--current')
  if (block.skipped) classes.push('block--skipped')
  if (block.locked) classes.push('block--locked')
  if (focused) classes.push('block--focus')
  if (movable) classes.push('block--movable')
  if (waits.length > 0) classes.push('block--blocked')
  if (relation !== null) classes.push(`block--${relation.role}`)
  const badge = relation?.badge === true ? relation.role : null
  const style: CSSProperties = {}
  if (offset !== undefined) style.transform = `translate(${offset.x}px, ${offset.y}px)`

  return (
    <li
      id={block.id}
      className={classes.join(' ')}
      style={style}
      data-block={block.id}
      data-movable={movable || undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className="block__number">{number}</span>
      <div className="block__head">
        {block.locked ? <LockIcon /> : <Lamp lamp={block.lamp} />}
        {block.locked ? (
          link === null ? (
            <span className="block__key">{block.id}</span>
          ) : (
            <a href={link} className="block__key" target="_blank" rel="noreferrer" draggable={false} title={t.chain.lockedTitle}>
              {block.id}
            </a>
          )
        ) : (
          <Link
            to={{ hash: block.id }}
            className="block__key"
            draggable={false}
            aria-current={focused ? 'true' : undefined}
          >
            {block.id}
          </Link>
        )}
      </div>
      <p className="block__title">
        {block.title !== null && (
          <button type="button" className="block__card" draggable={false} title={t.chain.openCard} onClick={onCard}>
            {block.title}
          </button>
        )}
      </p>
      <div className="block__side">
        {block.skipped && <span className="block__badge block__badge--skipped">{t.chain.skipped}</span>}
        {block.question && (
          <span className="block__badge block__badge--question" title={t.chain.questionTitle}>
            {t.chain.question}
          </span>
        )}
        {badge === 'blocker' && <span className="block__badge block__badge--blocker">{t.chain.blocker}</span>}
        {badge === 'dependent' && <span className="block__badge block__badge--dependent">{t.chain.dependent}</span>}
        {waits.length > 0 && (
          <span className="block__waits">
            <LockIcon />
            {t.chain.waits(waits.join(', '))}
          </span>
        )}
        {block.status !== null && !(block.current && block.session !== null) && <span className="block__status">{block.status}</span>}
        {block.current && checkpointHandoffs(block.sessions) > 0 && (
          <span className="block__badge" title={t.chain.handoffsTitle}>
            {t.chain.handoffs(checkpointHandoffs(block.sessions))}
          </span>
        )}
        {block.current && block.session !== null && (
          <span className="block__metrics">
            {block.session.cache !== null && <CacheClock cache={block.session.cache} />}
            <ContextMeter tokens={block.session.contextTokens} scale={scale} />
          </span>
        )}
        {block.skipped && (
          <button type="button" className="button block__return" disabled={onReturn === undefined} onClick={onReturn}>
            {t.common.restore}
          </button>
        )}
      </div>
    </li>
  )
}

function LockIcon() {
  return (
    <svg className="block__lock" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" />
      <path d="M 4 5.5 V 4 a 2 2 0 0 1 4 0 V 5.5" />
    </svg>
  )
}

function relativesOf(blocks: ChainBlock[], id: string | null): Relatives | null {
  if (id === null || !blocks.some((block) => block.id === id && (block.open || block.locked))) return null
  const found = relatives(linkedIds(blocks), blockersOf(blocks), id)
  return { blockers: new Set(found.blockers), dependents: new Set(found.dependents) }
}

function relationOf(id: string, drag: ChainDrag | null, selected: Relatives | null, pointed: Relatives | null): Relation | null {
  if (drag !== null) return drag.id === id ? { role: 'dragged', badge: false } : roleIn(drag, id, true)
  return (selected === null ? null : roleIn(selected, id, true)) ?? (pointed === null ? null : roleIn(pointed, id, false))
}

function roleIn(found: Relatives, id: string, badge: boolean): Relation | null {
  if (found.blockers.has(id)) return { role: 'blocker', badge }
  return found.dependents.has(id) ? { role: 'dependent', badge } : null
}

function openIds(blocks: ChainBlock[]): string[] {
  return blocks.filter((block) => block.open).map((block) => block.id)
}

function linkedIds(blocks: ChainBlock[]): string[] {
  return blocks.filter((block) => block.open || block.locked).map((block) => block.id)
}

function blockersOf(blocks: ChainBlock[]): Map<string, string[]> {
  return new Map(blocks.map((block) => [block.id, block.blockedBy]))
}

function withOrder(chain: ChainBlock[], order: string[]): ChainBlock[] {
  const byId = new Map(chain.map((block) => [block.id, block]))
  const open = order.filter((id) => byId.has(id))
  if (open.length !== openIds(chain).length) return chain
  const locked = chain.filter((block) => block.locked).map((block) => block.id)
  const placed = withWaiting(open, locked, blockersOf(chain)).map((id) => byId.get(id)!)
  return [...chain.filter((block) => !block.open && !block.locked), ...placed]
}

function listClass(dragging: boolean, landing: boolean): string {
  if (dragging) return 'chain__list chain__list--dragging'
  return landing ? 'chain__list chain__list--landing' : 'chain__list'
}
