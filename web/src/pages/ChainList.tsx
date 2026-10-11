import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { withWaiting } from '../../../src/chain/order.js'
import type { ContextScale, TrackerUrls } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { blockMetered, checkpointHandoffs, issueLink, type ChainBlock, type Ghost, type TaskLinks } from '../state.js'
import { AccountTag } from '../ui/AccountTag.js'
import { ARCHIVE_PAGE, archiveView } from '../ui/archive.js'
import { CacheClock } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { HandoffIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { landingIndex, revealElement } from '../ui/landing.js'
import { Links } from '../ui/Links.js'
import { estimateShare, isRework, railsOf, showsAction, tiersOf, type Rail, type Tier } from '../ui/look.js'
import { milestoneView, type Section } from '../ui/milestones.js'
import { placeLeaving, type Mark } from '../ui/motion.js'
import { relatives, type Point } from '../ui/reorder.js'
import { StartPill } from '../ui/SessionStart.js'
import { ActionScreen } from './ActionScreen.js'
import './chain.css'
import { ChainLegend } from './ChainLegend.js'
import type { Arrival } from './useArrival.js'
import { reorderable, useChainDrag, type ChainDrag, type Landing } from './useChainDrag.js'
import { useChainMotion } from './useChainMotion.js'

const GHOST_DELAY_MS = 200

interface Props {
  project: string
  chain: ChainBlock[]
  scale: ContextScale
  trackerUrls: TrackerUrls
  focus: string
  /** A backlog task shown at the place it would take in the chain. */
  ghost: Ghost | null
  arrival: Arrival | null
  incoming: string | null
  links: (task: string) => TaskLinks
  onCard: (task: string) => void
}

const NO_MARKS: ReadonlyMap<Mark, number> = new Map()

interface Relatives {
  blockers: ReadonlySet<string>
  dependents: ReadonlySet<string>
}

interface Relation {
  role: 'dragged' | 'blocker' | 'dependent'
  badge: boolean
}

export function ChainList({ project, chain, scale, trackerUrls, focus, ghost, arrival, incoming, links, onCard }: Props) {
  const [pages, setPages] = useState(0)
  const [revealed, setRevealed] = useState(0)
  const { send, sending, failure } = useCommand()
  const location = useLocation()
  const navigate = useNavigate()
  const [pending, setPending] = useState<string[] | null>(null)
  const served = openIds(chain).join(',')
  useEffect(() => setPending(null), [served])

  const ordered = pending === null ? chain : withOrder(chain, pending)
  const target = ghost?.id ?? arrival?.id ?? focus
  const archive = archiveView(withGhost(ordered, ghost), pages, target)
  const view = milestoneView(archive.visible, revealed, target)
  const blocks = view.sections.flatMap((section) => section.blocks)
  const shown = new Set(blocks.map((block) => block.id))
  const hidden = openIds(ordered).filter((id) => !shown.has(id))
  const open = new Set(linkedIds(ordered))
  const numbers = new Map(openIds(blocks).map((id, index) => [id, index + 1]))
  const [hovered, setHovered] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const motion = useChainMotion(project, ordered, shown, incoming)
  const real = blocks.filter((block) => block.id !== ghost?.id)
  const tiers = tiersOf(real.map((block) => ({ ...block, live: blockMetered(block) })))
  const rails = railsOf(real)
  const kin = real.find((block) => block.id === hovered)?.parent ?? null
  const slots = placeLeaving(
    view.sections.map((section) => section.blocks),
    motion.leaving,
  )
  const copies = new Map(motion.leaving.toReversed().map((each) => [each.item.id, each]))

  const keep = arrival === null ? 0 : view.revealed
  useEffect(() => setRevealed((current) => Math.max(current, keep)), [keep])

  const coming = ghost?.id ?? arrival?.id ?? null
  const ghosted = ghost !== null
  useEffect(() => {
    if (coming === null) return
    const timer = setTimeout(() => {
      const element = listRef.current?.querySelector(`[data-block="${CSS.escape(coming)}"]`)
      if (element) revealElement(element)
    }, ghosted ? GHOST_DELAY_MS : 0)
    return () => clearTimeout(timer)
  }, [coming, ghosted])

  const unfocus = (kept: ChainBlock[]) => {
    if (focus !== '' && !kept.some((block) => block.id === focus)) navigate({ search: location.search, hash: '' })
  }
  const collapseArchive = () => {
    setPages(0)
    unfocus(archiveView(ordered, 0, '').visible)
  }
  const foldMilestones = (kept: number) => {
    setRevealed(kept)
    unfocus(milestoneView(archive.visible, kept).sections.flatMap((section) => section.blocks))
  }

  const { drag, landing, settling, movable } = useChainDrag({
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
    <div className="chain" style={{ '--key-chars': keyChars(ordered) } as CSSProperties}>
      {(archive.hidden > 0 || archive.shown > 0) && (
        <div className="chain__archive">
          {archive.hidden > 0 && (
            <Divider
              name={t.chain.archive}
              count={t.chain.hidden(t.chain.tasks(archive.hidden))}
              hidden
              bump={motion.bump ?? undefined}
              toggle={{
                expanded: false,
                title: t.chain.loadMore(archive.next, archive.hidden),
                run: () => setPages(Math.ceil(archive.shown / ARCHIVE_PAGE) + 1),
              }}
            />
          )}
          {archive.shown > 0 && (
            <Divider
              name={t.chain.archive}
              count={t.chain.tasks(archive.shown)}
              toggle={{ expanded: true, title: t.chain.foldArchive, run: collapseArchive }}
            />
          )}
        </div>
      )}
      {motion.quiet && (
        <p className="chain__away" role="status">
          {t.chain.away(motion.quiet)}
        </p>
      )}
      <div ref={listRef} className={listClass(drag, landing, settling)}>
        {view.sections.map((section, index) => (
          <section
            key={`${index}:${section.milestone}`}
            className={index < view.fixed ? 'chain__section' : 'chain__section chain__section--revealed'}
          >
            {view.titled && (
              <Divider
                name={section.milestone ?? t.chain.noMilestone}
                count={t.chain.tasks(openCount(section, ghost))}
                toggle={
                  index < view.fixed
                    ? undefined
                    : { expanded: true, title: t.chain.foldMilestone, run: () => foldMilestones(index - view.fixed) }
                }
              />
            )}
            <ol className="chain__blocks">
              {slots[index]!.map(({ block, leaving }) =>
                leaving ? (
                  <LeavingBlock
                    key={`leaving:${block.id}`}
                    block={block}
                    archived={copies.get(block.id)?.archived === true}
                    beat={copies.get(block.id)?.beat ?? 0}
                  />
                ) : block.id === ghost?.id ? (
                  <GhostBlock key={block.id} block={block} />
                ) : (
                  <Block
                    key={block.id}
                    block={block}
                    link={block.locked ? issueLink(trackerUrls, block.id) : null}
                    number={numbers.get(block.id)}
                    waits={block.blockedBy.filter((id) => open.has(id))}
                    links={links(block.id)}
                    scale={scale}
                    tier={tiers.get(block.id) ?? 'near'}
                    rails={rails.get(block.id) ?? []}
                    kin={kin !== null && block.parent === kin}
                    marks={motion.marks.get(block.id) ?? NO_MARKS}
                    focused={block.id === focus}
                    movable={movable(block)}
                    relation={relationOf(block.id, drag, selected, pointed)}
                    arrival={arrival?.id === block.id ? arrival : null}
                    offset={landing?.id === block.id ? landing.offset : drag?.offsets.get(block.id)}
                    onHover={(inside) => setHovered((current) => (inside ? block.id : current === block.id ? null : current))}
                    onReturn={sending ? undefined : () => void send('chain/unskip', { project, task: block.id })}
                    onCard={onCard}
                  />
                ),
              )}
            </ol>
          </section>
        ))}
      </div>
      {view.next !== null && (
        <Divider
          name={view.next.milestone ?? t.chain.noMilestone}
          count={t.chain.hidden(t.chain.tasks(openCount(view.next, ghost)))}
          hidden
          toggle={{ expanded: false, title: t.chain.nextMilestone, run: () => setRevealed(view.revealed + 1) }}
        />
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <ChainLegend
        blocks={real}
        families={rails.size > 0}
        locked={blocks.some((block) => block.locked)}
        movable={blocks.some(reorderable)}
      />
    </div>
  )
}

function openCount(section: Section<ChainBlock>, ghost: Ghost | null): number {
  return section.blocks.filter((block) => !block.locked && block.id !== ghost?.id).length
}

/** The chain with a stand-in for the ghost at its landing place, unless the task is in the chain already. */
function withGhost(blocks: ChainBlock[], ghost: Ghost | null): ChainBlock[] {
  if (ghost === null || blocks.some((block) => block.id === ghost.id)) return blocks
  const stand: ChainBlock = {
    id: ghost.id,
    title: ghost.title,
    status: null,
    stage: null,
    lamp: 'ahead',
    open: false,
    locked: false,
    blockedBy: [],
    milestone: ghost.milestone,
    after: [],
    current: false,
    skipped: false,
    question: false,
    priority: 'none',
    estimate: null,
    parent: null,
    labels: [],
    models: [],
    session: null,
    sessions: [],
    limit: null,
    start: null,
  }
  const index = landingIndex(blocks, ghost.before)
  return [...blocks.slice(0, index), stand, ...blocks.slice(index)]
}

function GhostBlock({ block }: { block: ChainBlock }) {
  return (
    <li className="block block--ghost" data-block={block.id} aria-hidden="true">
      <span className="block__number" />
      <div className="block__head">
        <Lamp lamp="ahead" />
        <span className="block__key">{block.id}</span>
      </div>
      <span className="block__divider" />
      <p className="block__title">{block.title}</p>
      <div className="block__side">
        <span className="tag">{t.chain.ghost}</span>
      </div>
    </li>
  )
}

/** The key column fits the longest key of the whole chain, folded parts too, so it does not jump on unfolding. */
function keyChars(blocks: ChainBlock[]): number {
  return Math.max(0, ...blocks.map((block) => block.id.length))
}

/** The lamp already tells done, canceled and not started apart; only "In Progress" from "In Review" needs the word. */
function shownStatus(block: ChainBlock): string | null {
  return block.stage === 'Active' ? block.status : null
}

/** A copy of a block that left the chain, kept until it folds away: into the archive line if the task closed. */
function LeavingBlock({ block, archived, beat }: { block: ChainBlock; archived: boolean; beat: number }) {
  const style = { '--beat': `${beat}ms` } as CSSProperties
  return (
    <li className={`block block--${block.lamp} block--past block--leaving${archived ? ' block--archived' : ''}`} style={style} aria-hidden="true" inert>
      <span className="block__number" />
      <div className="block__head">
        <Lamp lamp={block.lamp} />
        <span className="block__key">{block.id}</span>
      </div>
      <span className="block__divider" aria-hidden="true" />
      <p className="block__title">{block.title}</p>
      <div className="block__side">{shownStatus(block) !== null && <span className="block__status">{shownStatus(block)}</span>}</div>
    </li>
  )
}

interface DividerProps {
  name: string
  count: string
  hidden?: boolean
  /** The delay before the count bumps as a closed task folds into the line. */
  bump?: number
  /** Makes the whole line a button that folds or reveals what the line stands for. */
  toggle?: { expanded: boolean; title: string; run: () => void }
}

function Divider({ name, count, hidden = false, bump, toggle }: DividerProps) {
  const line = (
    <>
      {toggle !== undefined && (
        <svg className="chain__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M4.5 2.5 8 6l-3.5 3.5" />
        </svg>
      )}
      <span className="chain__milestone-name">{name}</span>
      <span className="chain__milestone-line" aria-hidden="true" />
      <span className="chain__milestone-count">{count}</span>
    </>
  )
  const classes = ['chain__milestone']
  if (hidden) classes.push('chain__milestone--hidden')
  if (bump !== undefined) classes.push('chain__milestone--bump')
  return (
    <h2 className={classes.join(' ')} style={bump === undefined ? undefined : ({ '--beat': `${bump}ms` } as CSSProperties)}>
      {toggle === undefined ? (
        line
      ) : (
        <button type="button" className="chain__toggle" aria-expanded={toggle.expanded} title={toggle.title} onClick={toggle.run}>
          {line}
        </button>
      )}
    </h2>
  )
}

interface BlockProps {
  block: ChainBlock
  link: string | null
  number: number | undefined
  waits: string[]
  links: TaskLinks
  scale: ContextScale
  tier: Tier
  rails: Rail[]
  /** A sibling of the task under the cursor. */
  kin: boolean
  /** The marks of running motions, each with the delay of its own beat. */
  marks: ReadonlyMap<Mark, number>
  focused: boolean
  movable: boolean
  relation: Relation | null
  arrival: Arrival | null
  offset: Point | undefined
  onHover: (inside: boolean) => void
  onReturn: (() => void) | undefined
  onCard: (task: string) => void
}

function Block(props: BlockProps) {
  const { block, link, number, waits, links, scale, tier, rails, kin, marks, focused, movable, relation, arrival, offset, onHover, onReturn, onCard } = props
  const classes = ['block', `block--${block.lamp}`, `block--${tier}`, `block--priority-${block.priority}`]
  if (isRework(block.labels)) classes.push('block--rework')
  if (block.question) classes.push('block--question')
  if (kin) classes.push('block--kin')
  for (const mark of marks.keys()) classes.push(`block--${mark}`)
  if (block.current) classes.push('block--current')
  if (block.start !== null) classes.push('block--starting')
  if (block.skipped) classes.push('block--skipped')
  if (block.locked) classes.push('block--locked')
  if (focused) classes.push('block--focus')
  if (movable) classes.push('block--movable')
  if (waits.length > 0) classes.push('block--blocked')
  if (relation !== null) classes.push(`block--${relation.role}`)
  if (arrival !== null) classes.push(arrival.flying ? 'block--arriving' : 'block--landed')
  const badge = relation?.badge === true ? relation.role : null
  const metered = block.start === null && blockMetered(block) ? block.session : null
  const action = block.session !== null && showsAction(tier, block.session.lamp) ? block.session.action : null
  if (action !== null) classes.push('block--acting')
  const share = tier === 'past' ? null : estimateShare(block.estimate)
  const status = shownStatus(block)
  const handoffs = checkpointHandoffs(block.sessions)
  const style = {
    ...Object.fromEntries([...marks].map(([mark, beat]) => [`--beat-${mark}`, `${beat}ms`])),
    ...(share !== null && { '--estimate': share.toFixed(2) }),
    ...(offset !== undefined && { transform: `translate(${offset.x}px, ${offset.y}px)` }),
  } as CSSProperties

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
      {rails.map((rail) => (
        <span
          key={rail.family}
          className={`block__rail block__rail--${rail.part}`}
          style={{ '--lane': rail.lane, '--family': `var(--family-${rail.hue})` } as CSSProperties}
          title={rail.part === 'start' ? t.chain.family(rail.family) : undefined}
          aria-hidden="true"
        />
      ))}
      {block.priority === 'urgent' && <span className="block__hazard" aria-hidden="true" />}
      {block.question && <span className="block__corner" aria-hidden="true" />}
      {share !== null && <span className="block__estimate" aria-hidden="true" />}
      {marks.has('take') && <span className="block__frame" aria-hidden="true" />}
      <span className={`block__number block__number--${block.priority}`} title={priorityTitle(block)}>
        {block.current ? <PlayIcon /> : number}
      </span>
      <div className="block__head">
        {marks.has('finish') && <CheckIcon />}
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
      <span className="block__divider" aria-hidden="true" />
      <p className="block__title">
        {block.title !== null && (
          <button type="button" className="block__card" draggable={false} title={t.chain.openCard} onClick={() => onCard(block.id)}>
            {block.title}
          </button>
        )}
      </p>
      {action !== null && <ActionScreen line={action} />}
      <div className="block__side">
        {block.models.map((model) => (
          <span key={model} className="tag" title={t.card.roles.model}>
            {model}
          </span>
        ))}
        {block.skipped && <span className="chip">{t.chain.skipped}</span>}
        {block.question && (
          <span className="chip chip--question" title={t.chain.questionTitle}>
            {t.chain.question}
          </span>
        )}
        {badge === 'blocker' && <span className="tag">{t.chain.blocker}</span>}
        {badge === 'dependent' && <span className="tag">{t.chain.dependent}</span>}
        {block.start !== null && <StartPill start={block.start} />}
        {status !== null && metered === null && block.start === null && <span className="block__status">{status}</span>}
        {metered !== null && (
          <span className="block__metrics">
            <span className="block__metrics-row">
              {metered.cache !== null && <CacheClock cache={metered.cache} />}
              <ContextMeter tokens={metered.contextTokens} scale={scale} />
            </span>
            <span className="block__metrics-row block__metrics-row--who">
              <AccountTag email={metered.account} />
              <span
                className={handoffs > 0 ? 'block__handoffs' : 'block__handoffs block__handoffs--none'}
                role="img"
                aria-label={t.chain.handoffs(handoffs)}
                title={t.chain.handoffsTitle}
              >
                <HandoffIcon />
                {handoffs}
              </span>
            </span>
          </span>
        )}
        {block.skipped && (
          <button type="button" className="button block__return" disabled={onReturn === undefined} onClick={onReturn}>
            {t.common.restore}
          </button>
        )}
        <Links links={links} onCard={onCard} />
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

function PlayIcon() {
  return (
    <svg className="block__play" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M3.5 2.2v7.6L10 6z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="block__stamp" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

function priorityTitle(block: ChainBlock): string | undefined {
  if (block.priority === 'none' || block.priority === 'medium') return undefined
  return `${t.card.priority}: ${t.card.priorities[block.priority]}`
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

function listClass(drag: ChainDrag | null, landing: Landing | null, settling: boolean): string {
  if (drag !== null) return 'chain__list chain__list--dragging'
  if (landing?.moved) return 'chain__list'
  return landing !== null || settling ? 'chain__list chain__list--settling' : 'chain__list'
}
