import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { isOwnName } from '../../../src/chain/fix.js'
import type { ContextScale, TrackerUrls } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { blockMetered, issueLink, type ChainBlock, type Ghost, type ReadyButton, type TaskLinks } from '../state.js'
import { ARCHIVE_PAGE, archiveView } from '../ui/archive.js'
import { inOrder, withOrder } from '../ui/chainOrder.js'
import { ActionMeter, BlockMetrics, CacheRing } from '../ui/BlockMetrics.js'
import { IntoChainIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { landingIndex, revealElement } from '../ui/landing.js'
import { Links } from '../ui/Links.js'
import { estimateShare, isRework, railsOf, showsAction, tiersOf, type Rail, type Tier } from '../ui/look.js'
import { milestoneView, type Section } from '../ui/milestones.js'
import { placeLeaving, type Mark } from '../ui/motion.js'
import { PullChip } from '../ui/PullChip.js'
import { WorkChip } from '../ui/WorkChip.js'
import { sessionStatus } from './sessionStatus.js'
import { relatives, type Point } from '../ui/reorder.js'
import { StartPill } from '../ui/SessionStart.js'
import { ActionScreen } from './ActionScreen.js'
import './chain.css'
import { ChangelogButton } from './ChangelogDialog.js'
import { Forge } from './Forge.js'
import type { Arrival } from './useArrival.js'
import { useChainDrag, type ChainDrag, type Landing } from './useChainDrag.js'
import { useChainMotion } from './useChainMotion.js'

/** How long the ghost takes to grow open or fold shut. */
const GHOST_MS = 250
/** How long the frame of a taken block takes to draw (`frame-draw` in chain.css): its action prints after it. */
const FRAME_MS = 700

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
  /** The "Move to Todo" button of a locked blocker, `null` for none. */
  ready: (block: ChainBlock) => ReadyButton | null
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

export function ChainList({ project, chain, scale, trackerUrls, focus, ghost: aimed, arrival, incoming, links, ready, onCard }: Props) {
  const { ghost, leaving } = useLingering(aimed, chain)
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
  const settled = milestoneView(archive.visible, revealed, arrival?.id ?? focus).sections.length
  const blocks = view.sections.flatMap((section) => section.blocks)
  const shown = new Set([...archive.archived, ...blocks].map((block) => block.id))
  const hidden = openIds(ordered).filter((id) => !shown.has(id))
  const open = new Set(linkedIds(ordered))
  const numbers = new Map(openIds(blocks).map((id, index) => [id, index + 1]))
  const [hovered, setHovered] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const motion = useChainMotion(project, ordered, shown, incoming)
  const real = blocks.filter((block) => block.id !== ghost?.id)
  const tiers = tiersOf(real.map((block) => ({ ...block, live: blockMetered(block) })))
  // The ghost takes the size the task will have where it lands, so the swap for the real block does not jump.
  const ghostTier = ghost === null ? 'far' : (tiersOf(blocks.map((block) => ({ ...block, live: blockMetered(block) }))).get(ghost.id) ?? 'far')
  const rails = railsOf(real)
  const kin = real.find((block) => block.id === hovered)?.parent ?? null
  const slots = placeLeaving(
    view.sections.map((section) => section.blocks),
    motion.leaving,
  )
  const copies = new Map(motion.leaving.toReversed().map((each) => [each.item.id, each]))

  const keep = arrival === null ? 0 : view.revealed
  useEffect(() => setRevealed((current) => Math.max(current, keep)), [keep])

  const coming = aimed?.id ?? arrival?.id ?? null
  const ghosted = aimed !== null
  useEffect(() => {
    if (coming === null) return
    const timer = setTimeout(() => {
      const element = listRef.current?.querySelector(`[data-block="${CSS.escape(coming)}"]`)
      if (element) revealElement(element)
    }, ghosted ? GHOST_MS : 0)
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
      {archive.shown === 0
        ? archive.hidden > 0 && (
            <Divider
              name={t.chain.archive}
              count={t.chain.archived(archive.hidden - archive.hiddenFixes, archive.hiddenFixes)}
              hidden
              bump={motion.bump ?? undefined}
              toggle={{ expanded: false, title: t.chain.openArchive, run: () => setPages(1) }}
            />
          )
        : (
            <section className="chain__archive">
              <Divider
                name={t.chain.archive}
                count={
                  archive.hidden > 0
                    ? t.chain.archiveShown(archive.shown, archive.shown + archive.hidden)
                    : t.chain.archived(archive.shown - archive.shownFixes, archive.shownFixes)
                }
                bump={motion.bump ?? undefined}
                toggle={{ expanded: true, title: t.chain.foldArchive, run: collapseArchive }}
                action={
                  archive.hidden > 0 && (
                    <button
                      type="button"
                      className="chain__more"
                      title={t.chain.loadMore(archive.next, archive.hidden)}
                      onClick={() => setPages(Math.ceil(archive.shown / ARCHIVE_PAGE) + 1)}
                    >
                      {t.chain.archiveMore(archive.next)}
                    </button>
                  )
                }
              />
              <ol className="chain__archived">
                {archive.archived.map((block, index) => (
                  <ArchivedRow
                    key={block.id}
                    block={block}
                    milestone={block.milestone !== archive.archived[index - 1]?.milestone ? block.milestone : null}
                    focused={block.id === focus}
                  />
                ))}
              </ol>
            </section>
          )}
      {motion.quiet && (
        <p className="chain__away" role="status">
          {t.chain.away(motion.quiet)}
        </p>
      )}
      <div ref={listRef} className={listClass(drag, landing, settling)}>
        {view.sections.map((section, index) => (
          <section key={`${index}:${section.milestone}`} className={sectionClass(index, view.fixed, settled, leaving)}>
            {view.titled && (
              <Divider
                name={section.milestone ?? t.chain.noMilestone}
                count={t.chain.tasks(openCount(section, ghost))}
                toggle={
                  index < view.fixed
                    ? undefined
                    : { expanded: true, title: t.chain.foldMilestone, run: () => foldMilestones(index - view.fixed) }
                }
                action={section.milestone === null ? undefined : <ChangelogButton project={project} milestone={section.milestone} />}
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
                  <GhostBlock key={block.id} block={block} tier={ghostTier} leaving={leaving} />
                ) : (
                  <Block
                    key={block.id}
                    project={project}
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
                    onDismiss={sending ? undefined : () => void send('chain/dismiss', { project, task: block.id })}
                    ready={block.locked ? ready(block) : null}
                    onReady={sending ? undefined : () => void send('task/ready', { task: block.id })}
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
    </div>
  )
}

function openCount(section: Section<ChainBlock>, ghost: Ghost | null): number {
  return section.blocks.filter((block) => !block.locked && block.id !== ghost?.id && !isOwnName(block.id)).length
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
    runLabels: [],
    session: null,
    sessions: [],
    limit: null,
    start: null,
  }
  const index = landingIndex(blocks, ghost.before)
  return [...blocks.slice(0, index), stand, ...blocks.slice(index)]
}

/** The ghost stays a moment after the pointer leaves its button, to fold shut rather than vanish. */
function useLingering(ghost: Ghost | null, chain: ChainBlock[]): { ghost: Ghost | null; leaving: boolean } {
  const [kept, setKept] = useState<Ghost | null>(null)
  if (ghost !== null && ghost.id !== kept?.id) setKept(ghost)
  const taken = kept !== null && chain.some((block) => block.id === kept.id && block.open)
  const gone = ghost === null && kept !== null && !taken
  useEffect(() => {
    if (taken) setKept(null)
    if (!gone) return
    const timer = setTimeout(() => setKept(null), GHOST_MS)
    return () => clearTimeout(timer)
  }, [gone, taken])
  return gone ? { ghost: kept, leaving: true } : { ghost, leaving: false }
}

/** Sections past `settled` are open only to show the ghost: they grow and fold with it. */
function sectionClass(index: number, fixed: number, settled: number, leaving: boolean): string {
  const classes = ['chain__section']
  if (index >= fixed) classes.push('chain__section--revealed')
  if (index >= settled) classes.push('chain__section--ghost')
  if (index >= settled && leaving) classes.push('chain__section--gone')
  return classes.join(' ')
}

function GhostBlock({ block, tier, leaving }: { block: ChainBlock; tier: Tier; leaving: boolean }) {
  return (
    <li className={`block block--ghost block--${tier}${leaving ? ' block--ghost-out' : ''}`} data-block={block.id} aria-hidden="true">
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

/** A row of the unfolded archive: one quiet line, its milestone named only where the milestone changes. */
function ArchivedRow({ block, milestone, focused }: { block: ChainBlock; milestone: string | null; focused: boolean }) {
  return (
    <li id={block.id} className={`archived archived--${block.lamp}${focused ? ' archived--focus' : ''}`} data-block={block.id}>
      <span className="archived__head">
        <Lamp lamp={block.lamp} />
        <Link to={{ hash: block.id }} className="archived__key" draggable={false} aria-current={focused ? 'true' : undefined}>
          {block.id}
        </Link>
      </span>
      <span className="archived__title" title={block.title ?? undefined}>
        {block.title}
        {isOwnName(block.id) && <Forge lamp={block.lamp} />}
      </span>
      {milestone !== null && <span className="archived__milestone">{milestone}</span>}
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
  /** A button of its own after the line, outside the toggle. */
  action?: ReactNode
}

function Divider({ name, count, hidden = false, bump, toggle, action }: DividerProps) {
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
      {action}
    </h2>
  )
}

interface BlockProps {
  project: string
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
  onDismiss: (() => void) | undefined
  ready: ReadyButton | null
  onReady: (() => void) | undefined
  onCard: (task: string) => void
}

function Block(props: BlockProps) {
  const { project, block, link, number, waits, links, scale, tier, rails, kin, marks, focused, movable, relation, arrival, offset, onHover, onReturn, onDismiss, ready, onReady, onCard } =
    props
  const classes = ['block', `block--${block.lamp}`, `block--${tier}`, `block--priority-${block.priority}`]
  if (isRework(block.labels)) classes.push('block--rework')
  if (block.question) classes.push('block--question')
  if (kin) classes.push('block--kin')
  for (const mark of marks.keys()) classes.push(`block--${mark}`)
  if (block.current) classes.push('block--current')
  if (block.start !== null) classes.push('block--starting')
  if (block.skipped) classes.push('block--skipped')
  if (block.locked) classes.push('block--locked')
  if (block.review !== undefined && !block.open) classes.push('block--review')
  if (focused) classes.push('block--focus')
  if (movable) classes.push('block--movable')
  if (waits.length > 0) classes.push('block--blocked')
  if (relation !== null) classes.push(`block--${relation.role}`)
  if (arrival !== null) classes.push(arrival.flying ? 'block--arriving' : 'block--landed')
  const badge = relation?.badge === true ? relation.role : null
  const metered = block.start === null && blockMetered(block) ? block.session : null
  const acting = metered !== null && showsAction(tier, metered.lamp)
  if (acting) classes.push('block--acting')
  // The ring takes the place of the current row's ▶, or the empty one of a row without a number.
  const ring = metered?.cache != null && (block.current || number === undefined) ? metered.cache : null
  const share = tier === 'past' ? null : estimateShare(block.estimate)
  const status = shownStatus(block)
  const fix = isOwnName(block.id)
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
      {ready === null ? (
        <span className={ring === null ? `block__number block__number--${block.priority}` : 'block__number'} title={priorityTitle(block)}>
          {ring !== null ? <CacheRing cache={ring} /> : fix ? null : block.current ? <PlayIcon /> : number}
        </span>
      ) : (
        <button
          type="button"
          className="block__ready"
          disabled={onReady === undefined || ready.refused !== null}
          aria-label={t.card.ready}
          title={ready.refused === null ? t.card.ready : t.chain.readyRefused(say(ready.refused))}
          draggable={false}
          onClick={onReady}
        >
          <IntoChainIcon />
        </button>
      )}
      <div className="block__head">
        {marks.has('finish') && <CheckIcon />}
        {block.locked ? <LockIcon /> : <Lamp lamp={block.lamp} label={block.lamp === 'waiting' && block.session?.apiErrorKind === 'transient' ? sessionStatus(block.session) : undefined} />}
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
        {block.title !== null &&
          (block.locked ? (
            <button type="button" className="block__card" draggable={false} title={t.chain.openCard} onClick={() => onCard(block.id)}>
              {block.title}
            </button>
          ) : (
            // Plain text: a press anywhere on the row lands on the key's link and opens the session panel, the card (or a fix's CI) is in its head.
            block.title
          ))}
        {fix && <Forge lamp={block.lamp} />}
      </p>
      {acting && (
        <ActionMeter project={project} session={metered} sessions={block.sessions} scale={scale}>
          {metered.action === null ? (
            <div className="block__action" />
          ) : (
            <ActionScreen line={metered.action} delay={marks.has('take') ? marks.get('take')! + FRAME_MS : 0} />
          )}
        </ActionMeter>
      )}
      <div className="block__side">
        {block.runLabels.map((label) => (
          <RunLabelTag key={label} label={label} />
        ))}
        {block.skipped && <span className="chip">{t.chain.skipped}</span>}
        {block.interrupted && (
          <span className="chip" title={t.chain.interruptedTitle}>
            {t.chain.interrupted}
          </span>
        )}
        {block.review !== undefined && <PullChip review={block.review} />}
        {block.question && (
          <span className="chip chip--question" title={t.chain.questionTitle}>
            {t.chain.question}
          </span>
        )}
        {block.work !== undefined && <WorkChip work={block.work} leftovers={block.leftovers} />}
        {badge === 'blocker' && <span className="tag">{t.chain.blocker}</span>}
        {badge === 'dependent' && <span className="tag">{t.chain.dependent}</span>}
        {block.start !== null && <StartPill start={block.start} />}
        {status !== null && metered === null && block.start === null && <span className="block__status">{status}</span>}
        {metered !== null && !acting && (
          <BlockMetrics project={project} session={metered} sessions={block.sessions} scale={scale} ring={ring === null} />
        )}
        {block.skipped && (
          <button type="button" className="button button--small block__return" disabled={onReturn === undefined} onClick={onReturn}>
            {t.common.restore}
          </button>
        )}
        {block.leftovers !== undefined && (
          <button type="button" className="button button--small block__return" disabled={onDismiss === undefined} onClick={onDismiss}>
            {t.project.dismiss}
          </button>
        )}
        <Links links={links} onCard={onCard} />
      </div>
    </li>
  )
}

export function LockIcon() {
  return (
    <svg className="block__lock" viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" />
      <path d="M 4 5.5 V 4 a 2 2 0 0 1 4 0 V 5.5" />
    </svg>
  )
}

export function PlayIcon() {
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
  return blocks.filter(inOrder).map((block) => block.id)
}

function linkedIds(blocks: ChainBlock[]): string[] {
  return blocks.filter((block) => block.open || block.locked).map((block) => block.id)
}

function blockersOf(blocks: ChainBlock[]): Map<string, string[]> {
  return new Map(blocks.map((block) => [block.id, block.blockedBy]))
}

function listClass(drag: ChainDrag | null, landing: Landing | null, settling: boolean): string {
  if (drag !== null) return 'chain__list chain__list--dragging'
  return landing !== null || settling ? 'chain__list chain__list--settling' : 'chain__list'
}
