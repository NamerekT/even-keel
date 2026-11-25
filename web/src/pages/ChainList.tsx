import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { isOwnName } from '../../../src/chain/fix.js'
import type { ContextScale } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { chainRefusal } from '../chainRefusal.js'
import { blockMetered, type ChainBlock, type Ghost, type ReadyButton, type TaskLinks } from '../state.js'
import { ARCHIVE_PAGE, archiveView } from '../ui/archive.js'
import { inOrder, underWayFirst, withOrder } from '../ui/chainOrder.js'
import { ChevronIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { landingIndex, revealElement } from '../ui/landing.js'
import { railsOf, tiersOf, type Tier } from '../ui/look.js'
import { rowLinkSearch } from '../parents.js'
import { milestoneView, type EmptyMilestones, type Section } from '../ui/milestones.js'
import { chainPlace, looseGhost, takesGhost, type MilestoneRules } from '../ui/addGhost.js'
import { AddGhost } from './AddGhost.js'
import { placeLeaving, type Mark, type Motion, type Slot } from '../ui/motion.js'
import { firstGroup, type GroupTone } from '../ui/runningGroup.js'
import { useRowGlide } from './useRowGlide.js'
import { droppedOrder, milestonePage, staysInView, type MilestonePage } from '../ui/chainPage.js'
import { relatives } from '../ui/reorder.js'
import './chain.css'
import { ChangelogButton } from './ChangelogDialog.js'
import { ChainArchive } from './ChainArchive.js'
import { Block, type Relation } from './ChainRow.js'
import { Divider, HiddenCount } from './ChainDivider.js'
import type { Arrival } from './useArrival.js'
import { useLockedEntry } from './useLockedEntry.js'
import { useChainDrag, type ChainDrag, type Landing } from './useChainDrag.js'
import { useChainMotion, useSwitched } from './useChainMotion.js'
import { useArchivePages } from './useArchivePages.js'
import { Bracket } from '../ui/Bracket.js'

/** How long the ghost takes to grow open or fold shut. */
const GHOST_MS = 250
const NO_MEMBERS: readonly string[] = []

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
  /** The ghost and the arrival of a locked blocker its button puts into the chain, as `useArrival` gives them; none — no ghost. */
  entry?: Entry
  /** The task has the "To the backlog" button. */
  unready: (block: ChainBlock) => boolean
  onCard: (task: string) => void
  /** The built-in tracker's add ghosts (BTN-770); `null` — the project is on another tracker. */
  adding?: Adding | null
  /** The feed's view switch, at the right of its top row (BTN-1041). */
  switcher?: ReactNode
  /** The address search a row's link keeps, so a row of the parents view opens its panel there. */
  rowSearch?: string
  /** The machine the chain is filtered to; `undefined` — all machines. A switch of it is no motion of the chain (BTN-1577). */
  machine?: string
}

export interface Entry {
  point: (task: string | null) => void
  move: (task: string, title: string, locked: boolean) => void
  settle: (task: string) => void
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

export function ChainList(props: Props) {
  const { project, chain, scale, focus, ghost: aimed, arrival, incoming, links, ready, entry, unready, onCard, adding = null, switcher, rowSearch, machine } = props
  const { ghost, leaving } = useLingering(aimed, chain)
  /** The ghost is a locked blocker's: its row stays in the chain beside it and its button is under the cursor. */
  const lockedAim = aimed !== null && chain.some((block) => block.id === aimed.id && block.locked)
  const stands = (block: ChainBlock) => block.id === ghost?.id && !block.locked && !block.open
  const [archivePages, setArchivePages] = useState(0)
  const [revealed, setRevealed] = useState(0)
  /** The presses of each milestone's "N more" button, by milestone; a fold of the milestone forgets them. */
  const [more, setMore] = useState<ReadonlyMap<string, number>>(new Map())
  const command = useCommand()
  // A drop's refusal is a toast in sight (BTN-1644), not the band under the list's last row the row buttons' errors take.
  const ordering = useCommand()
  const { send, failure } = command
  const sending = command.sending || ordering.sending
  const location = useLocation()
  const navigate = useNavigate()
  // A row's link keeps the page's query, the machine of the view with it (BTN-1575).
  const linkSearch = rowLinkSearch(location.search, rowSearch)
  const [pending, setPending] = useState<string[] | null>(null)
  const served = openIds(chain).join(',')
  useEffect(() => setPending(null), [served])

  const ordered = pending === null ? underWayFirst(chain) : withOrder(chain, pending)
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
    milestonePage(section.blocks, more.get(pageKey(section)) ?? 0, { keeps: staysInView, counts: (block) => !stands(block), focus }),
  )
  const rows = pages.map((page) => [...page.head, ...page.kept])
  const blocks = rows.flat()
  const shown = new Set([...archive.archived, ...blocks].map((block) => block.id))
  const open = new Set(linkedIds(ordered))
  const numbers = new Map(openIds(view.sections.flatMap((section) => section.blocks)).map((id, index) => [id, index + 1]))
  const [hovered, setHovered] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Each view of the feed and each machine's keeps its own last frame: a switch of the view is no motion of the chain.
  const chainView = `${project}${rowSearch === undefined ? '' : `?${rowSearch}`}${machine === undefined ? '' : `@${machine}`}`
  const group = firstGroup(rows)
  const members = group?.members ?? NO_MEMBERS
  const grouped = useMemo(() => new Set(members), [members.join(',')])
  // The edge keeps its colour while the group breaks up.
  const lastTone = useRef<GroupTone>('working')
  if (group !== null) lastTone.current = group.tone
  const frameRef = useRef<HTMLDivElement>(null)
  const glide = useRef<(motion: Motion<ChainBlock>) => void>(() => {})
  const motion = useChainMotion(chainView, ordered, shown, incoming, grouped, (each) => glide.current(each))
  const switched = useSwitched(chainView)
  const real = blocks.filter((block) => !stands(block))
  const tiers = tiersOf(real.map((block) => ({ ...block, live: blockMetered(block) })))
  // The ghost takes the size the task will have where it lands, so the swap for the real block does not jump.
  const ghostTier = ghost === null ? 'far' : (tiersOf(blocks.map((block) => ({ ...block, live: blockMetered(block) }))).get(ghost.id) ?? 'far')
  const rails = railsOf(real)
  const kin = real.find((block) => block.id === hovered)?.parent ?? null
  const slots = placeLeaving(rows, motion.leaving)
  const copies = new Map(motion.leaving.toReversed().map((each) => [each.item.id, each]))

  const keep = arrival === null ? 0 : view.revealed
  useEffect(() => setRevealed((current) => Math.max(current, keep)), [keep])
  // A run that comes in above the open milestones — a task without one landing among them — does not fold the last of them (BTN-1642).
  const lastShown = useRef<string | null | undefined>(undefined)
  const tail = view.sections.at(-1)?.milestone
  const following = view.next?.milestone
  useEffect(() => {
    if (following !== undefined && following !== null && following === lastShown.current) setRevealed(view.revealed + 1)
    else lastShown.current = tail
  }, [tail, following, view.revealed])

  // A locked blocker's ghost is not scrolled to: that would take its button from under the cursor; its landing is.
  const ghosted = aimed !== null && !lockedAim
  const coming = (ghosted ? aimed.id : null) ?? arrival?.id ?? null
  const lockedEntry = useLockedEntry(listRef, lockedAim ? aimed.id : null, arrival !== null && !arrival.flying ? arrival.id : null)
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
    lastShown.current = undefined
    setRevealed(kept)
    const folded = view.sections.slice(view.fixed + kept).map(pageKey)
    setMore((current) => new Map([...current].filter(([key]) => !folded.includes(key))))
    unfocus(milestoneView(archive.visible, kept, '', empty).sections.flatMap((section) => section.blocks))
  }

  const dropped = useRef<string | null>(null)
  const { drag, landing, settling, dropped: justDropped, movable, held, afterDrop } = useChainDrag({
    listRef,
    blocks,
    disabled: sending,
    onDrop: (order, moved) => {
      const full = droppedOrder(openIds(ordered), order, moved)
      setPending(full)
      dropped.current = moved
      chainRefusal.set(null)
      void ordering.send('chain/order', { project, order: full }).then((ok) => ok || afterDrop(() => setPending(null)))
    },
  })
  useEffect(() => {
    if (ordering.failure !== null && dropped.current !== null) chainRefusal.set({ task: dropped.current, notice: ordering.failure })
  }, [ordering.failure])
  useRowGlide(listRef, frameRef, members, glide, chainView, held)

  const selected = relativesOf(blocks, focus)
  const pointed = relativesOf(blocks, hovered)

  return (
    <div className="chain" style={{ '--key-chars': keyChars(ordered) } as CSSProperties}>
      <ChainArchive
        archive={archive}
        switcher={switcher}
        bump={motion.bump ?? undefined}
        focus={focus}
        rowSearch={linkSearch}
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
      <div ref={listRef} className={listClass(drag, landing, settling)} style={{ '--group-edge': `var(--lamp-${lastTone.current})` } as CSSProperties}>
        <div ref={frameRef} className="chain__group" aria-hidden="true">
          <span className="chain__group-caption">{t.chain.underWay}</span>
        </div>
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
                ) : stands(block) ? (
                  <GhostBlock key={`ghost:${block.id}`} block={block} tier={ghostTier} leaving={leaving} />
                ) : (
                  <Block
                    key={block.id}
                    project={project}
                    block={block}
                    search={linkSearch}
                    number={numbers.get(block.id)}
                    waits={block.blockedBy.filter((id) => open.has(id))}
                    links={links(block.id)}
                    scale={scale}
                    tier={tiers.get(block.id) ?? 'near'}
                    rails={rails.get(block.id) ?? []}
                    kin={kin !== null && block.parent === kin}
                    marks={motion.marks.get(block.id) ?? NO_MARKS}
                    grouped={!grouped.has(block.id) ? null : block.id === members[0] ? 'first' : 'inner'}
                    still={switched}
                    focused={block.id === focus}
                    movable={movable(block)}
                    relation={relationOf(block.id, drag, selected, pointed)}
                    dropped={block.id === justDropped}
                    arrival={arrival?.id === block.id ? arrival : null}
                    offset={landing?.id === block.id ? landing.offset : drag?.offsets.get(block.id)}
                    onHover={(inside) => setHovered((current) => (inside ? block.id : current === block.id ? null : current))}
                    onDismiss={sending ? undefined : () => void send('chain/dismiss', { project, task: block.id })}
                    onReassign={sending ? undefined : () => void send('chain/reassign', { project, task: block.id })}
                    ready={block.locked ? ready(block) : null}
                    onReady={sending ? undefined : () => {
                      if (entry !== undefined) {
                        lockedEntry.press(block.id)
                        // The button goes with the lock: the press holds the ghost till the landing, the pointer no longer.
                        entry.point(null)
                        entry.move(block.id, block.title ?? block.id, true)
                      }
                      void send('task/ready', { task: block.id }).then(() => entry?.settle(block.id))
                    }}
                    onAim={entry === undefined ? undefined : (on) => {
                      lockedEntry.aim(on ? block.id : null)
                      entry.point(on ? block.id : null)
                    }}
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
              {section.blocks.some((block) => block.locked) && <Bracket blockers=".block--locked" />}
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

/** The chain with a stand-in for the ghost at its landing place, unless the task is in the chain already other than as a locked blocker. */
function withGhost(blocks: ChainBlock[], ghost: Ghost | null): ChainBlock[] {
  if (ghost === null || blocks.some((block) => block.id === ghost.id && !block.locked)) return blocks
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
  const index = landingIndex(blocks, ghost.before, ghost.id)
  // A locked blocker's stand joins the section of the task it stands before, as the locked rows do: its own milestone would split that section.
  if (blocks.some((block) => block.id === ghost.id)) stand.milestone = blocks[index]?.milestone ?? ghost.milestone
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
