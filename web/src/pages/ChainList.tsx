import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { isOwnName } from '../../../src/chain/fix.js'
import type { ContextScale } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { blockMetered, sessionCache, taskTitle, type ChainBlock, type Ghost, type ReadyButton, type TaskLinks } from '../state.js'
import { ARCHIVE_PAGE, archiveView } from '../ui/archive.js'
import { inOrder, withOrder } from '../ui/chainOrder.js'
import { ActionMeter, CacheRing } from '../ui/BlockMetrics.js'
import { ChevronIcon, IntoChainIcon, OutOfChainIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { useLive } from '../live/context.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { MachineTag } from '../ui/MachineTag.js'
import { landingIndex, revealElement } from '../ui/landing.js'
import { Links } from '../ui/Links.js'
import { isRework, railsOf, showsAction, tiersOf, type Rail, type Tier } from '../ui/look.js'
import { parentsTo } from '../parents.js'
import { milestoneView, type EmptyMilestones, type Section } from '../ui/milestones.js'
import { chainPlace, looseGhost, takesGhost, type MilestoneRules } from '../ui/addGhost.js'
import { AddGhost } from './AddGhost.js'
import { placeLeaving, type Mark, type Slot } from '../ui/motion.js'
import { droppedOrder, milestonePage, staysInView, type MilestonePage } from '../ui/chainPage.js'
import { PullChip } from '../ui/PullChip.js'
import { WorkChip } from '../ui/WorkChip.js'
import { cardAction, lampLabel } from './sessionStatus.js'
import { relatives, type Point } from '../ui/reorder.js'
import { StartPill } from '../ui/SessionStart.js'
import { ActionScreen } from './ActionScreen.js'
import { BlockTail } from './BlockTail.js'
import { useNarrow } from '../layout/useNarrow.js'
import './chain.css'
import { ChangelogButton } from './ChangelogDialog.js'
import { ChainArchive } from './ChainArchive.js'
import { Divider, HiddenCount, SubtasksChip } from './ChainDivider.js'
import { Forge } from './Forge.js'
import type { Arrival } from './useArrival.js'
import { useChainDrag, type ChainDrag, type Landing } from './useChainDrag.js'
import { useChainMotion } from './useChainMotion.js'
import { useArchivePages } from './useArchivePages.js'

/** How long the ghost takes to grow open or fold shut. */
const GHOST_MS = 250
/** How long the frame of a taken block takes to draw (`frame-draw` in chain.css): its action prints after it. */
const FRAME_MS = 700

interface Props {
  project: string
  chain: ChainBlock[]
  scale: ContextScale
  focus: string
  /** A backlog task shown at the place it would take in the chain. */
  ghost: Ghost | null
  arrival: Arrival | null
  incoming: string | null
  links: (task: string) => TaskLinks
  /** The "Move to Todo" button of a locked blocker, `null` for none. */
  ready: (block: ChainBlock) => ReadyButton | null
  /** The task has the "To the backlog" button. */
  unready: (block: ChainBlock) => boolean
  onCard: (task: string) => void
  /** The built-in tracker's add ghosts (BTN-770); `null` — the project is on another tracker. */
  adding?: Adding | null
  /** The feed's view switch, at the right of its top row (BTN-1041). */
  switcher?: ReactNode
  /** The address search a row's link keeps, so a row of the parents view opens its panel there. */
  rowSearch?: string
}

export interface Adding {
  rules: MilestoneRules
  /** The project's milestones no task carries: empty groups, each with its ghost. */
  empty: EmptyMilestones
  /** The chain runs: the ghost's tip says the new task is taken in its turn. */
  running: boolean
}

const NO_MARKS: ReadonlyMap<Mark, number> = new Map()

interface Relatives {
  blockers: ReadonlySet<string>
  dependents: ReadonlySet<string>
}

/** A blocker of the pointed, selected or dragged task lights its key, a dependent its lock (`block--blocker`, `block--dependent`). */
type Relation = 'dragged' | 'blocker' | 'dependent'

export function ChainList(props: Props) {
  const { project, chain, scale, focus, ghost: aimed, arrival, incoming, links, ready, unready, onCard, adding = null, switcher, rowSearch } = props
  const { ghost, leaving } = useLingering(aimed, chain)
  const [archivePages, setArchivePages] = useState(0)
  const [revealed, setRevealed] = useState(0)
  /** The presses of each milestone's "N more" button, by milestone; a fold of the milestone forgets them. */
  const [more, setMore] = useState<ReadonlyMap<string, number>>(new Map())
  const { send, sending, failure } = useCommand()
  const location = useLocation()
  const navigate = useNavigate()
  const [pending, setPending] = useState<string[] | null>(null)
  const served = openIds(chain).join(',')
  useEffect(() => setPending(null), [served])

  const ordered = pending === null ? chain : withOrder(chain, pending)
  const target = ghost?.id ?? arrival?.id ?? focus
  const older = useArchivePages(project, focus, (id) => ordered.some((block) => block.id === id))
  const archive = archiveView(withGhost(ordered, ghost), archivePages, target, older)
  /** Opens the archive to `count` pages, asking the server first for the rows the page does not have (BTN-1445). */
  const unfold = (count: number, busy: 'open' | 'more') => {
    const missing = Math.min(count * ARCHIVE_PAGE, archive.shown + archive.hidden) - archive.loaded
    if (missing <= 0) setArchivePages(count)
    else older.load(missing, busy, () => setArchivePages(count))
  }
  const empty = adding?.empty
  const view = milestoneView(archive.visible, revealed, target, empty)
  const settled = milestoneView(archive.visible, revealed, arrival?.id ?? focus, empty).sections.length
  // A ghost or an arrival behind a milestone's button stays there: only the address's focus opens the page (BTN-1188).
  const pages = view.sections.map((section) =>
    milestonePage(section.blocks, more.get(pageKey(section)) ?? 0, { keeps: staysInView, counts: (block) => block.id !== ghost?.id, focus }),
  )
  const rows = pages.map((page) => [...page.head, ...page.kept])
  const blocks = rows.flat()
  const shown = new Set([...archive.archived, ...blocks].map((block) => block.id))
  const open = new Set(linkedIds(ordered))
  const numbers = new Map(openIds(view.sections.flatMap((section) => section.blocks)).map((id, index) => [id, index + 1]))
  const [hovered, setHovered] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Each view of the feed keeps its own last frame: a switch of the view is no motion of the chain.
  const motion = useChainMotion(rowSearch === undefined ? project : `${project}?${rowSearch}`, ordered, shown, incoming)
  const real = blocks.filter((block) => block.id !== ghost?.id)
  const tiers = tiersOf(real.map((block) => ({ ...block, live: blockMetered(block) })))
  // The ghost takes the size the task will have where it lands, so the swap for the real block does not jump.
  const ghostTier = ghost === null ? 'far' : (tiersOf(blocks.map((block) => ({ ...block, live: blockMetered(block) }))).get(ghost.id) ?? 'far')
  const rails = railsOf(real)
  const kin = real.find((block) => block.id === hovered)?.parent ?? null
  const slots = placeLeaving(rows, motion.leaving)
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
    setArchivePages(0)
    unfocus(archiveView(ordered, 0, '').visible)
  }
  const foldMilestones = (kept: number) => {
    setRevealed(kept)
    const folded = view.sections.slice(view.fixed + kept).map(pageKey)
    setMore((current) => new Map([...current].filter(([key]) => !folded.includes(key))))
    unfocus(milestoneView(archive.visible, kept, '', empty).sections.flatMap((section) => section.blocks))
  }

  const { drag, landing, settling, movable } = useChainDrag({
    listRef,
    blocks,
    disabled: sending,
    onDrop: (order, moved) => {
      const full = droppedOrder(openIds(ordered), order, moved)
      setPending(full)
      void send('chain/order', { project, order: full }).then((ok) => ok || setPending(null))
    },
  })

  const selected = relativesOf(blocks, focus)
  const pointed = relativesOf(blocks, hovered)

  return (
    <div className="chain" style={{ '--key-chars': keyChars(ordered) } as CSSProperties}>
      <ChainArchive
        archive={archive}
        switcher={switcher}
        bump={motion.bump ?? undefined}
        focus={focus}
        rowSearch={rowSearch}
        busy={older.busy}
        onOpen={() => unfold(1, 'open')}
        onMore={() => unfold(Math.ceil(archive.shown / ARCHIVE_PAGE) + 1, 'more')}
        onFold={collapseArchive}
      />
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
              {withButton(slots[index]!, pages[index]!).map((slot) => {
                if (slot === 'more') return <MoreRows key="more" page={pages[index]!} onMore={() => setMore((current) => pressed(current, section))} />
                const { block } = slot
                return slot.leaving ? (
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
                    search={rowSearch}
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
                    onDismiss={sending ? undefined : () => void send('chain/dismiss', { project, task: block.id })}
                    onReassign={sending ? undefined : () => void send('chain/reassign', { project, task: block.id })}
                    ready={block.locked ? ready(block) : null}
                    onReady={sending ? undefined : () => void send('task/ready', { task: block.id })}
                    onUnready={!unready(block) ? null : sending ? undefined : () => void send('task/unready', { task: block.id })}
                    onCard={onCard}
                  />
                )
              })}
              {adding !== null && index < settled && takesGhost(section, adding.rules) && (
                <li className="chain__add">
                  <AddGhost
                    project={project}
                    place={chainPlace(section.milestone)}
                    label={section.milestone === null ? t.chain.add.task : t.chain.add.toMilestone(section.milestone)}
                    tip={adding.running ? t.chain.add.queued : null}
                    onCard={onCard}
                  />
                </li>
              )}
            </ol>
          </section>
        ))}
      </div>
      {adding !== null && looseGhost(view.sections, adding.rules) && (
        <div className="chain__loose">
          <AddGhost project={project} place={chainPlace(null)} label={t.chain.add.task} tip={adding.running ? t.chain.add.queued : null} onCard={onCard} />
        </div>
      )}
      {view.next !== null && (
        <Divider
          name={view.next.milestone ?? t.chain.noMilestone}
          count={<HiddenCount tasks={openCount(view.next, ghost)} />}
          hidden
          toggle={{ expanded: false, title: t.chain.nextMilestone, run: () => setRevealed(view.revealed + 1) }}
        />
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}

/** The milestone a section's "N more" presses are kept under. */
function pageKey(section: Section<ChainBlock>): string {
  return section.milestone ?? ''
}

function pressed(more: ReadonlyMap<string, number>, section: Section<ChainBlock>): Map<string, number> {
  const key = pageKey(section)
  return new Map(more).set(key, (more.get(key) ?? 0) + 1)
}

/** The section's slots with the "N more" button after the last row of its head, above the rows kept past the cut. */
function withButton(slots: Slot<ChainBlock>[], page: MilestonePage<ChainBlock>): (Slot<ChainBlock> | 'more')[] {
  if (page.hidden === 0) return slots
  const kept = new Set(page.kept.map((block) => block.id))
  const cut = slots.findIndex((slot) => !slot.leaving && kept.has(slot.block.id))
  const at = cut < 0 ? slots.length : cut
  return [...slots.slice(0, at), 'more', ...slots.slice(at)]
}

/** A row of the chain's width that adds the next rows of a long milestone (BTN-1188). */
function MoreRows({ page, onMore }: { page: MilestonePage<ChainBlock>; onMore: () => void }) {
  return (
    <li className="chain__page">
      <button type="button" className="chain__page-more" onClick={onMore}>
        <ChevronIcon />
        <span>{t.chain.pageMore(page.next, page.hidden)}</span>
      </button>
    </li>
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
    run: null,
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
      <div className="block__side" />
    </li>
  )
}

interface BlockProps {
  project: string
  block: ChainBlock
  search: string | undefined
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
  onDismiss: (() => void) | undefined
  /** "Reassign" of a task a machine gone holds (BTN-1270); `undefined` — off while a command is on its way. */
  onReassign: (() => void) | undefined
  ready: ReadyButton | null
  onReady: (() => void) | undefined
  /** "To the backlog"; `null` — the row has no such button, `undefined` — it is off while a command is on its way. */
  onUnready: (() => void) | null | undefined
  onCard: (task: string) => void
}

function Block(props: BlockProps) {
  const { project, block, search, number, waits, links, scale, tier, rails, kin, marks, focused, movable, relation, arrival, offset, onHover, onDismiss, onReassign, ready, onReady, onUnready, onCard } =
    props
  const { state } = useLive()
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
  if (relation !== null) classes.push(`block--${relation}`)
  if (arrival !== null) classes.push(arrival.flying ? 'block--arriving' : 'block--landed')
  const metered = block.start === null && blockMetered(block) ? block.session : null
  const acting = metered !== null && showsAction(tier, metered.lamp)
  const action = metered === null ? null : cardAction(metered)
  if (acting) classes.push('block--acting')
  // The ring takes the place of the current row's ▶, or the empty one of a row without a number.
  const ring = metered !== null && (block.current || number === undefined) ? sessionCache(metered) : null
  const fix = isOwnName(block.id)
  const style = {
    ...Object.fromEntries([...marks].map(([mark, beat]) => [`--beat-${mark}`, `${beat}ms`])),
    ...(offset !== undefined && { transform: `translate(${offset.x}px, ${offset.y}px)` }),
  } as CSSProperties
  // On a phone the run, the links and the row's button stand in the key's line (BTN-1162).
  const narrow = useNarrow()
  const readyButton = ready === null ? null : (
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
  )
  // Takes no room until the row is pointed at, then slides out before the lock and the key, which stay put (BTN-1162).
  const unreadyButton =
    onUnready === null ? null : (
      <button
        type="button"
        className="block__unready"
        disabled={onUnready === undefined}
        aria-label={t.card.unready}
        title={t.card.unready}
        draggable={false}
        onClick={onUnready}
      >
        <OutOfChainIcon />
      </button>
    )

  return (
    <li
      id={block.id}
      className={classes.join(' ')}
      style={style}
      data-block={block.id}
      data-movable={movable || undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      // A double click opens the card (BTN-880); the row's own buttons and links keep theirs, the title is not selected.
      onMouseDown={(event) => {
        if (event.detail > 1) event.preventDefault()
      }}
      onDoubleClick={(event) => {
        if (!ownControl(event.target)) onCard(block.id)
      }}
    >
      {rails.map((rail) => (
        <RailLink key={rail.family} project={project} rail={rail} />
      ))}
      {block.question && <span className="block__corner" role="img" aria-label={t.chain.questionTitle} title={t.chain.questionTitle} />}
      {marks.has('take') && <span className="block__frame" aria-hidden="true" />}
      {ready === null || narrow ? (
        <span
          className={ring === null ? `block__number block__number--${block.priority}` : 'block__number'}
          title={ring === null ? priorityTitle(block, number) : undefined}
        >
          {ring !== null ? <CacheRing cache={ring} note={priorityTitle(block, number)} /> : fix ? null : block.current ? <PlayIcon /> : block.priority === 'urgent' ? '!' : number}
        </span>
      ) : (
        readyButton
      )}
      <div className="block__head">
        {marks.has('finish') && <CheckIcon />}
        {block.locked ? <LockIcon /> : <Lamp lamp={block.lamp} label={lampLabel(block.lamp, block.session, new Date())} />}
        {block.locked ? (
          // A blocker outside the chain has no session to show: a press anywhere on its row opens its card, which links to the tracker.
          <button type="button" className="block__key" draggable={false} title={t.chain.openCard} onClick={() => onCard(block.id)}>
            {block.id}
          </button>
        ) : (
          <Link
            to={{ search, hash: block.id }}
            className="block__key"
            draggable={false}
            aria-current={focused ? 'true' : undefined}
          >
            {block.id}
          </Link>
        )}
      </div>
      {narrow && (
        <BlockTail run={block.run} machines={block.machines} links={links} onCard={onCard}>
          {readyButton ?? unreadyButton}
        </BlockTail>
      )}
      <span className="block__divider" aria-hidden="true" />
      <p className="block__title">
        {/* Plain text: a press anywhere on the row lands on the key — the session panel, whose head opens the card (or a fix's CI), or a locked blocker's card. */}
        {block.title}
        {fix && <Forge lamp={block.lamp} />}
      </p>
      {acting && (
        <ActionMeter project={project} session={metered} sessions={block.sessions} scale={scale}>
          {action === null ? (
            <div className="block__action" />
          ) : (
            <ActionScreen line={action} delay={marks.has('take') ? marks.get('take')! + FRAME_MS : 0} />
          )}
        </ActionMeter>
      )}
      <div className="block__side">
        {block.subtasks !== undefined && <SubtasksChip family={block.id} subtasks={block.subtasks} />}
        {!narrow && block.machines !== undefined && <MachineTag machines={block.machines} />}
        {!narrow && block.run !== null && <RunLabelTag run={block.run} />}
        {block.skipped && <span className="chip">{t.chain.skipped}</span>}
        {block.interrupted && (
          <span className="chip" title={t.chain.interruptedTitle}>
            {t.chain.interrupted}
          </span>
        )}
        {block.review !== undefined && <PullChip review={block.review} />}
        {block.work !== undefined && <WorkChip work={block.work} leftovers={block.leftovers} />}
        {block.start !== null && <StartPill start={block.start} />}
        {/* A session that does not work shows no meter on its row: its lamp says its state, its panel the numbers (BTN-1162). */}
        {block.leftovers !== undefined && (
          <button type="button" className="button button--small block__return" disabled={onDismiss === undefined} onClick={onDismiss}>
            {t.project.dismiss}
          </button>
        )}
        {block.stranded !== undefined && (
          <button
            type="button"
            className="button button--small block__return"
            disabled={onReassign === undefined || block.stranded.pushed !== true}
            title={
              block.stranded.pushed === true
                ? t.chain.reassignTitle(block.stranded.machine)
                : block.stranded.pushed === false
                  ? t.chain.reassignUnpushed(block.stranded.machine)
                  : t.chain.reassignUnknown(block.stranded.machine)
            }
            onClick={onReassign}
          >
            {t.chain.reassign}
          </button>
        )}
        {!narrow && unreadyButton}
        {!narrow && <Links links={links} onCard={onCard} stack />}
      </div>
    </li>
  )
}

/** A row's piece of its family's rail; while the parent is known, a press on the rail opens it among the parents (BTN-1041). */
function RailLink({ project, rail }: { project: string; rail: Rail }) {
  const { state } = useLive()
  const location = useLocation()
  const parent = state?.parents?.[project]?.find((task) => task.id === rail.family)
  const name = t.chain.family(rail.family, parent?.title ?? taskTitle(state?.tasks, project, rail.family))
  const style = { '--lane': rail.lane, '--family': `var(--family-${rail.hue})` } as CSSProperties
  return (
    <>
      {parent !== undefined && (
        <Link
          to={parentsTo(location.search, rail.family)}
          className="block__rail-hit"
          style={style}
          title={`${name}\n${t.chain.familyOpen(rail.family)}`}
          aria-label={t.chain.familyOpen(rail.family)}
          draggable={false}
        />
      )}
      <span
        className={`block__rail block__rail--${rail.part}`}
        style={style}
        title={parent === undefined && rail.part === 'start' ? name : undefined}
        aria-hidden="true"
      />
    </>
  )
}

/** A control of the row other than its stretched key: a double click there is that control's. */
function ownControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('button, input, a:not(.block__key)') !== null
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

/** An urgent row's "!" stands where its place in the chain was: the tip gives the place back. */
function priorityTitle(block: ChainBlock, number: number | undefined): string | undefined {
  if (block.priority === 'none' || block.priority === 'medium') return undefined
  const title = `${t.card.priority}: ${t.card.priorities[block.priority]}`
  return block.priority === 'urgent' && number !== undefined ? `${title}\n${t.chain.place(number)}` : title
}

function relativesOf(blocks: ChainBlock[], id: string | null): Relatives | null {
  if (id === null || !blocks.some((block) => block.id === id && (block.open || block.locked))) return null
  const found = relatives(linkedIds(blocks), blockersOf(blocks), id)
  return { blockers: new Set(found.blockers), dependents: new Set(found.dependents) }
}

function relationOf(id: string, drag: ChainDrag | null, selected: Relatives | null, pointed: Relatives | null): Relation | null {
  if (drag !== null) return drag.id === id ? 'dragged' : roleIn(drag, id)
  // One task's links at a time: two tasks' keys and locks in one blue would not say whose they are. The pointed row
  // goes first, so the open one never hides it; off the rows the open one shows its own.
  const shown = pointed ?? selected
  return shown === null ? null : roleIn(shown, id)
}

function roleIn(found: Relatives, id: string): Relation | null {
  if (found.blockers.has(id)) return 'blocker'
  return found.dependents.has(id) ? 'dependent' : null
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
