import type { CSSProperties } from 'react'
import { Link, useLocation } from 'react-router'
import { isOwnName } from '../../../src/chain/fix.js'
import type { ContextScale } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { blockMetered, sessionCache, taskTitle, type ChainBlock, type ReadyButton, type TaskLinks } from '../state.js'
import { ActionMeter, CacheRing } from '../ui/BlockMetrics.js'
import { IntoChainIcon, OutOfChainIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { useLive } from '../live/context.js'
import { RunLabelTag } from '../ui/RunLabelTag.js'
import { MachineTag } from '../ui/MachineTag.js'
import { Links } from '../ui/Links.js'
import { isRework, showsAction, type Rail, type Tier } from '../ui/look.js'
import { parentsTo } from '../parents.js'
import { STEP_MS, type Mark } from '../ui/motion.js'
import { PullChip } from '../ui/PullChip.js'
import { WorkChip } from '../ui/WorkChip.js'
import { cardAction, lampLabel } from './sessionStatus.js'
import type { Point } from '../ui/reorder.js'
import { StartPill } from '../ui/SessionStart.js'
import { ActionScreen } from './ActionScreen.js'
import { BlockTail } from './BlockTail.js'
import { PinWaitChip } from './PinWaitChip.js'
import { useNarrow } from '../layout/useNarrow.js'
import { SubtasksChip } from './ChainDivider.js'
import { Forge } from './Forge.js'
import type { Arrival } from './useArrival.js'

/** How long the frame of a taken block takes to draw (`frame-draw` in chain.css): its action prints after it. */
const FRAME_MS = STEP_MS

/** A blocker of the pointed, selected or dragged task lights its key, a dependent its lock (`block--blocker`, `block--dependent`). */
export type Relation = 'dragged' | 'blocker' | 'dependent'

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
  /** A row of the running group (BTN-1613): the group's frame is its frame; `null` — outside it. */
  grouped: 'first' | 'inner' | null
  /** The render switches the chain's view: a row that mounts in it shows its action line as it is. */
  still: boolean
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
  /** The pointer or the focus comes to the "Into the chain" button (`true`) or leaves it; `undefined` — no ghost to show. */
  onAim: ((on: boolean) => void) | undefined
  /** "To the backlog"; `null` — the row has no such button, `undefined` — it is off while a command is on its way. */
  onUnready: (() => void) | null | undefined
  onCard: (task: string) => void
}

/** A task's row of the chain. */
export function Block(props: BlockProps) {
  const { project, block, search, number, waits, links, scale, tier, rails, kin, marks, grouped, still, focused, movable, relation, arrival, offset, onHover, onDismiss, onReassign, ready, onReady, onAim, onUnready, onCard } =
    props
  const { state } = useLive()
  const classes = ['block', `block--${block.lamp}`, `block--${tier}`, `block--priority-${block.priority}`]
  if (isRework(block.labels)) classes.push('block--rework')
  if (block.question) classes.push('block--question')
  if (kin) classes.push('block--kin')
  for (const mark of marks.keys()) classes.push(`block--${mark}`)
  if (block.current) classes.push('block--current')
  if (grouped !== null) classes.push('block--grouped', `block--group-${grouped}`)
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
      onMouseEnter={onAim && (() => onAim(true))}
      onMouseLeave={onAim && (() => onAim(false))}
      onFocus={onAim && (() => onAim(true))}
      onBlur={onAim && (() => onAim(false))}
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
        <BlockTail run={block.run} machines={block.machines} pinned={block.pinned === true} links={links} onCard={onCard}>
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
        <ActionMeter project={project} session={metered} sessions={block.sessions} scale={scale} still={still}>
          {action === null ? (
            <div className="block__action" />
          ) : (
            <ActionScreen line={action} delay={marks.has('take') ? marks.get('take')! + FRAME_MS : 0} still={still} />
          )}
        </ActionMeter>
      )}
      <div className="block__side">
        {block.subtasks !== undefined && <SubtasksChip family={block.id} subtasks={block.subtasks} />}
        {!narrow && block.machines !== undefined && <MachineTag machines={block.machines} pinned={block.pinned === true} />}
        {!narrow && block.run !== null && <RunLabelTag run={block.run} />}
        {block.pinWait !== undefined && <PinWaitChip wait={block.pinWait} onOpen={() => onCard(block.id)} />}
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
