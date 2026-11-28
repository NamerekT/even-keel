import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import type { ArchivePage, OutsideReason, OutsideTask } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { chainTo } from '../parents.js'
import type { ChainBlock } from '../state.js'
import { taskLamp } from '../taskLamp.js'
import { Bracket } from '../ui/Bracket.js'
import { ChevronIcon, FlagIcon } from '../ui/icons.js'
import { FoldBody } from '../ui/Fold.js'
import { Lamp } from '../ui/Lamp.js'
import { Loading } from '../ui/Loader.js'
import { chainHolders, heldInChain, openText, outsideGroups, outsidePage, outsideShown, parseOpen, type OutsideGroup } from '../ui/outside.js'
import { Tipped } from '../ui/Tipped.js'
import { compareTasks, OUTSIDE_ORDER_KEY, useBacklogOrder } from './backlogOrder.js'
import { Divider } from './ChainDivider.js'
import { LockIcon } from './ChainRow.js'
import { OrderSwitch } from './OrderSwitch.js'
import { StatusDot } from './StatusDot.js'
import './chain.css'
import './outside.css'

interface Read {
  tasks: OutsideTask[] | null
  failed: boolean
}

/** The closed tasks read so far, the last closed first; `next` — the cursor of older ones, `null` — none left. */
interface Archive {
  tasks: Task[]
  next: string | null
}

interface Props {
  project: string
  switcher: ReactNode
  /** The chain's rows: an open chain task that blocks a task of the view stands before it (BTN-1714). */
  chain: readonly ChainBlock[]
  /** Bumped by every edit of the task card: the view reads anew, so a changed status moves its row at once (BTN-1673). */
  edits?: number
  onCard: (task: string) => void
}

/**
 * The "Outside the chain" view of the project's feed (BTN-1428): the open tasks the rules keep out of both the chain and
 * the backlog, in groups by the reason, under them by milestone and by status (BTN-1673), and above them the folded
 * archive of the closed ones an excluding label or a left-out milestone kept out. Read when the view opens, and anew
 * without the loader after a card's edit and each read of the tracker; a row only opens the task's card.
 */
export function OutsideView({ project, switcher, chain: blocks, edits = 0, onCard }: Props) {
  const { state, read } = useLive()
  const [loaded, setLoaded] = useState<Read>({ tasks: null, failed: false })
  const [archive, setArchive] = useState<Archive | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { open, setOpen } = useOpenGroups(project)
  const [archiveOpen, setArchiveOpen] = useArchiveOpen(project)
  const [order, setOrder] = useBacklogOrder(OUTSIDE_ORDER_KEY)
  const [more, setMore] = useState<Partial<Record<OutsideReason, number>>>({})
  const readAt = state?.trackers.find((view) => view.projects.includes(project))?.readAt[project]
  const reads = useRef(0)

  const readAll = (silent: boolean) => {
    const id = ++reads.current
    const current = () => id === reads.current
    read<OutsideTask[]>('outside/tasks', { project })
      .then((tasks) => current() && setLoaded({ tasks, failed: false }))
      .catch((error: unknown) => {
        console.warn(`outside/tasks ${project}: ${error instanceof Error ? error.message : String(error)}`)
        // A silent re-read that fails keeps the rows; with none read yet it is the failed read, not an endless loader.
        if (current()) setLoaded((was) => (silent && was.tasks !== null ? was : { tasks: null, failed: true }))
      })
    read<ArchivePage>('outside/archive', { project, after: null })
      .then((page) => current() && setArchive(page))
      .catch((error: unknown) => console.warn(`outside/archive ${project}: ${error instanceof Error ? error.message : String(error)}`))
  }

  useEffect(() => {
    readAll(false)
    return () => {
      reads.current += 1
    }
  }, [project, attempt])

  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    readAll(true)
  }, [edits, readAt])

  const older = () => {
    if (archive === null || archive.next === null || archiveBusy) return
    const id = reads.current
    setArchiveBusy(true)
    read<ArchivePage>('outside/archive', { project, after: archive.next })
      .then((page) => {
        if (id !== reads.current) return
        setArchive((current) => {
          const known = new Set((current?.tasks ?? []).map((task) => task.id))
          return { tasks: [...(current?.tasks ?? []), ...page.tasks.filter((task) => !known.has(task.id))], next: page.next }
        })
      })
      .catch((error: unknown) => console.warn(`outside/archive ${project}: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setArchiveBusy(false))
  }

  const chain = state?.chain.projects[project]
  // What the chain orders and the backlog stay theirs, whatever the read said; a waiting blocker stands in both (BTN-1768).
  const shown = outsideShown(chain)
  const groups = loaded.tasks === null ? [] : outsideGroups(loaded.tasks, shown, compareTasks(order))
  const keyChars = Math.max(0, ...[...(loaded.tasks ?? []).map((each) => each.task), ...(archive?.tasks ?? []), ...(loaded.tasks ?? []).flatMap((each) => chainHolders(each.task.blockedBy, blocks))].map((task) => task.id.length))
  const retry = () => {
    setLoaded({ tasks: null, failed: false })
    setAttempt((count) => count + 1)
  }

  return (
    <div className="chain outside" style={{ '--key-chars': keyChars } as CSSProperties}>
      <OutsideArchive
        archive={archive}
        open={archiveOpen}
        busy={archiveBusy}
        onToggle={() => setArchiveOpen(!archiveOpen)}
        onOlder={older}
        onCard={onCard}
        tools={
          <span className="chain__switch outside__tools">
            {groups.length > 0 && <OrderSwitch value={order} label={t.chain.outside.order} onChange={setOrder} />}
            {switcher}
          </span>
        }
      />
      {loaded.failed ? (
        <p className="notice notice--error outside__failed">
          <span>{t.chain.outside.failed}</span>
          <button type="button" className="button button--small" onClick={retry}>
            {t.chain.outside.retry}
          </button>
        </p>
      ) : (
        <Loading busy={loaded.tasks === null} label={t.chain.outside.loading} fit="block">
          {groups.length === 0 ? (
            <p className="placeholder">{t.chain.outside.empty}</p>
          ) : (
            groups.map((group) => (
              <Group
                key={group.reason}
                group={group}
                chain={blocks}
                open={open.includes(group.reason)}
                more={more[group.reason] ?? 0}
                onToggle={() => setOpen(group.reason, !open.includes(group.reason))}
                onMore={() => setMore((current) => ({ ...current, [group.reason]: (current[group.reason] ?? 0) + 1 }))}
                onCard={onCard}
              />
            ))
          )}
        </Loading>
      )}
    </div>
  )
}

interface ArchiveProps {
  archive: Archive | null
  open: boolean
  busy: boolean
  /** The order switch and the view switch, at the right of the top row. */
  tools: ReactNode
  onToggle: () => void
  onOlder: () => void
  onCard: (task: string) => void
}

/** The top row: the archive's line while it has tasks, the switches at its right; unfolded, the closed rows under it. */
function OutsideArchive({ archive, open, busy, tools, onToggle, onOlder, onCard }: ArchiveProps) {
  const tasks = archive?.tasks ?? []
  const left = archive?.next != null
  const line =
    tasks.length === 0 ? null : (
      <Divider
        name={t.chain.archive}
        count={t.chain.outside.archiveCount(tasks.length, left)}
        hidden={!open}
        toggle={{ expanded: open, title: open ? t.chain.foldArchive : t.chain.openArchive, run: onToggle }}
        action={
          open &&
          left && (
            <button type="button" className="chain__more" title={t.chain.outside.archiveOlderTip} aria-busy={busy ? 'true' : undefined} onClick={onOlder}>
              {t.chain.outside.archiveOlder}
            </button>
          )
        }
      />
    )
  return (
    <section className="chain__archive outside__archive">
      <div className="chain__top">
        {line}
        {tools}
      </div>
      {open && tasks.length > 0 && (
        <ol className="chain__archived">
          {tasks.map((task, index) => (
            <ArchivedRow key={task.id} task={task} milestone={task.milestone?.label !== tasks[index - 1]?.milestone?.label ? (task.milestone?.label ?? null) : null} onCard={onCard} />
          ))}
        </ol>
      )}
    </section>
  )
}

/** A closed row as the chain's archive draws one, its milestone named only where it changes; a press opens the card. */
function ArchivedRow({ task, milestone, onCard }: { task: Task; milestone: string | null; onCard: (task: string) => void }) {
  const lamp = taskLamp(task, null)
  return (
    <li className={`archived archived--${lamp}`} data-block={task.id}>
      <span className="archived__head">
        <Lamp lamp={lamp} />
        <button type="button" className="archived__key" title={t.chain.openCard} onClick={() => onCard(task.id)}>
          {task.id}
        </button>
      </span>
      <span className="archived__title" title={task.title}>
        {task.title}
      </span>
      <span className="archived__side">{milestone !== null && <span className="archived__milestone">{milestone}</span>}</span>
    </li>
  )
}

interface GroupProps {
  group: OutsideGroup
  chain: readonly ChainBlock[]
  open: boolean
  more: number
  onToggle: () => void
  onMore: () => void
  onCard: (task: string) => void
}

function Group({ group, chain, open, more, onToggle, onMore, onCard }: GroupProps) {
  const id = `outside-${group.reason}`
  return (
    <section className="outside__group">
      <Divider
        name={t.chain.outside[group.reason]}
        count={t.chain.tasks(group.count)}
        toggle={{ expanded: open, title: open ? t.chain.outside.fold : t.chain.outside.unfold, run: onToggle }}
      />
      <FoldBody open={open} id={id}>
        {() => <GroupRows group={group} chain={chain} more={more} onMore={onMore} onCard={onCard} />}
      </FoldBody>
    </section>
  )
}

function GroupRows({ group, chain, more, onMore, onCard }: Omit<GroupProps, 'open' | 'onToggle'>) {
  const page = outsidePage(group, more)
  const location = useLocation()
  // A holder's link opens its session panel in the chain, the rest of the address kept.
  const toChain = chainTo(location.search).search
  return (
    <div className="outside__rows">
      {page.sections.map((section) => (
        <div key={section.milestone?.label ?? ''} className="outside__section">
          <h3 className="outside__milestone">
            <FlagIcon />
            <span className="outside__milestone-name">{section.milestone?.label ?? t.chain.noMilestone}</span>
            <span className="chain__milestone-line" aria-hidden="true" />
            <span className="outside__milestone-count">{section.count}</span>
          </h3>
          {section.statuses.map((status) => (
            <div key={status.status.name} className="outside__status">
              <h4 className="outside__status-head">
                <StatusDot status={status.status} />
                <span className="outside__status-name">{status.status.name}</span>
                <span className="outside__status-count">{status.count}</span>
              </h4>
              <ol className="chain__blocks">
                {status.tasks.map((each) => {
                  const holders = chainHolders(each.task.blockedBy, chain)
                  return (
                    <Fragment key={each.task.id}>
                      {holders.map((holder) => (
                        <HolderRow key={`${each.task.id}:${holder.id}`} block={holder} search={toChain} onCard={onCard} />
                      ))}
                      <Row task={each.task} holds={heldInChain(each.task.id, chain).map((held) => held.id)} onCard={onCard} />
                    </Fragment>
                  )
                })}
                {status.tasks.some((each) => chainHolders(each.task.blockedBy, chain).length > 0) && <Bracket blockers=".outside__holder" />}
              </ol>
            </div>
          ))}
        </div>
      ))}
      {page.hidden > 0 && (
        <button type="button" className="chain__page-more" onClick={onMore}>
          <ChevronIcon />
          <span>{t.chain.pageMore(page.next, page.hidden)}</span>
        </button>
      )}
    </div>
  )
}

/**
 * A task's row as the chain draws a far one, without a number or a milestone: its status's dot for the lamp, the name in
 * its tip, the right side empty (BTN-1673); a press on its key opens the card. A waiting blocker has the lock for the lamp,
 * as its row in the chain has, its tip naming the chain's tasks it holds (`holds`) under the status (BTN-1768).
 */
function Row({ task, holds, onCard }: { task: Task; holds: readonly string[]; onCard: (task: string) => void }) {
  const lamp = taskLamp(task, null)
  const held = holds.length > 0
  const tip = held ? (
    <>
      <span className="tip__head">{task.status.name}</span>
      <span>{t.chain.outside.holds(holds)}</span>
    </>
  ) : (
    task.status.name
  )
  return (
    <li className={`block block--${lamp} block--far block--priority-${task.priority}`} data-block={task.id} onDoubleClick={() => onCard(task.id)}>
      <span className="block__number" />
      <div className="block__head">
        <Tipped tip={tip} inline className={held ? 'outside__lamp outside__holds' : 'outside__lamp'}>
          {held ? <LockIcon /> : <StatusDot status={task.status} />}
        </Tipped>
        <button type="button" className="block__key" title={t.chain.openCard} onClick={() => onCard(task.id)}>
          {task.id}
        </button>
      </div>
      <span className="block__divider" aria-hidden="true" />
      <p className="block__title">{task.title}</p>
      <div className="block__side" />
    </li>
  )
}

/**
 * A chain task that holds the task under it (BTN-1714): a dashed row in from the others, its tracker status's dot and the
 * status in words at the right, so it shows whether it is under way; its key opens its session in the chain.
 */
function HolderRow({ block, search, onCard }: { block: ChainBlock; search: string; onCard: (task: string) => void }) {
  const working = block.current || block.lamp === 'working'
  return (
    <li className={`block block--${block.lamp} block--far outside__holder`} data-block={block.id} onDoubleClick={() => onCard(block.id)}>
      <span className="block__number" />
      <div className="block__head">
        <span className="outside__lamp">{block.stage === null ? <Lamp lamp={block.lamp} /> : <StatusDot status={{ category: block.stage }} />}</span>
        <Link to={{ search, hash: block.id }} className="block__key">
          {block.id}
        </Link>
      </div>
      <span className="block__divider" aria-hidden="true" />
      <p className="block__title">{block.title ?? block.id}</p>
      <div className="block__side">{block.status !== null && <span className={working ? 'outside__holder-status outside__holder-status--working' : 'outside__holder-status'}>{block.status}</span>}</div>
    </li>
  )
}

const OPEN_KEY = 'even-keel.outside.open.'
const ARCHIVE_KEY = 'even-keel.outside.archive.'

/** Which groups are open, kept for the project on this device. */
function useOpenGroups(project: string): { open: OutsideReason[]; setOpen: (reason: OutsideReason, on: boolean) => void } {
  const [open, setList] = useState(() => readOpen(project))
  const setOpen = (reason: OutsideReason, on: boolean) => {
    const next = on ? [...open.filter((each) => each !== reason), reason] : open.filter((each) => each !== reason)
    setList(next)
    try {
      localStorage.setItem(OPEN_KEY + project, openText(next))
    } catch {}
  }
  return { open, setOpen }
}

function readOpen(project: string): OutsideReason[] {
  try {
    return parseOpen(localStorage.getItem(OPEN_KEY + project))
  } catch {
    return parseOpen(null)
  }
}

/** Whether the archive is unfolded, kept for the project on this device; folded until opened. */
function useArchiveOpen(project: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(ARCHIVE_KEY + project) === '1'
    } catch {
      return false
    }
  })
  const choose = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(ARCHIVE_KEY + project, next ? '1' : '0')
    } catch {}
  }
  return [open, choose]
}
