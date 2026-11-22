import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { OutsideReason, OutsideTask } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { taskLamp } from '../taskLamp.js'
import { ChevronIcon, FlagIcon } from '../ui/icons.js'
import { FoldBody } from '../ui/Fold.js'
import { Lamp } from '../ui/Lamp.js'
import { Loading } from '../ui/Loader.js'
import { openText, outsideGroups, outsidePage, parseOpen, type OutsideGroup } from '../ui/outside.js'
import { Divider } from './ChainDivider.js'
import { lampLabel } from './sessionStatus.js'
import './chain.css'
import './outside.css'

interface Read {
  tasks: OutsideTask[] | null
  failed: boolean
}

/**
 * The "Outside the chain" view of the project's feed (BTN-1428): the open tasks the rules keep out of both the chain and
 * the backlog, read once when the view opens (`outside/tasks`), in groups by the reason and under them by milestone. Only
 * the open groups draw their rows; a row only opens the task's card.
 */
export function OutsideView({ project, switcher, onCard }: { project: string; switcher: ReactNode; onCard: (task: string) => void }) {
  const { state, read } = useLive()
  const [loaded, setLoaded] = useState<Read>({ tasks: null, failed: false })
  const [attempt, setAttempt] = useState(0)
  const { open, setOpen } = useOpenGroups(project)
  const [more, setMore] = useState<Partial<Record<OutsideReason, number>>>({})

  useEffect(() => {
    let live = true
    read<OutsideTask[]>('outside/tasks', { project })
      .then((tasks) => live && setLoaded({ tasks, failed: false }))
      .catch((error: unknown) => {
        console.warn(`outside/tasks ${project}: ${error instanceof Error ? error.message : String(error)}`)
        if (live) setLoaded({ tasks: null, failed: true })
      })
    return () => {
      live = false
    }
  }, [project, attempt])

  const order = state?.chain.projects[project]
  // What the chain shows (its order and its locked blockers) and the backlog stay theirs, whatever the read said.
  const shown = new Set([...(order?.order ?? []), ...(order?.waiting ?? []), ...(order?.backlog ?? [])])
  const groups = loaded.tasks === null ? [] : outsideGroups(loaded.tasks, shown)
  const keyChars = Math.max(0, ...(loaded.tasks ?? []).map((each) => each.task.id.length))
  const retry = () => {
    setLoaded({ tasks: null, failed: false })
    setAttempt((count) => count + 1)
  }

  return (
    <div className="chain outside" style={{ '--key-chars': keyChars } as CSSProperties}>
      {switcher !== undefined && <div className="chain__top">{switcher}</div>}
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

interface GroupProps {
  group: OutsideGroup
  open: boolean
  more: number
  onToggle: () => void
  onMore: () => void
  onCard: (task: string) => void
}

function Group({ group, open, more, onToggle, onMore, onCard }: GroupProps) {
  const id = `outside-${group.reason}`
  return (
    <section className="outside__group">
      <Divider
        name={t.chain.outside[group.reason]}
        count={t.chain.tasks(group.count)}
        toggle={{ expanded: open, title: open ? t.chain.outside.fold : t.chain.outside.unfold, run: onToggle }}
      />
      <FoldBody open={open} id={id}>
        {() => <GroupRows group={group} more={more} onMore={onMore} onCard={onCard} />}
      </FoldBody>
    </section>
  )
}

function GroupRows({ group, more, onMore, onCard }: Omit<GroupProps, 'open' | 'onToggle'>) {
  const page = outsidePage(group, more)
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
          <ol className="chain__blocks">
            {section.tasks.map((each) => (
              <Row key={each.task.id} each={each} label={group.labels ? (each.label ?? null) : null} onCard={onCard} />
            ))}
          </ol>
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

/** A task's row as the chain draws a far one, without a number or a milestone: a press on its key opens the card. */
function Row({ each, label, onCard }: { each: OutsideTask; label: string | null; onCard: (task: string) => void }) {
  const { task } = each
  const lamp = taskLamp(task, null)
  return (
    <li className={`block block--${lamp} block--far block--priority-${task.priority}`} data-block={task.id} onDoubleClick={() => onCard(task.id)}>
      <span className="block__number" />
      <div className="block__head">
        <Lamp lamp={lamp} label={lampLabel(lamp, null, new Date())} />
        <button type="button" className="block__key" title={t.chain.openCard} onClick={() => onCard(task.id)}>
          {task.id}
        </button>
      </div>
      <span className="block__divider" aria-hidden="true" />
      <p className="block__title">{task.title}</p>
      <div className="block__side">{label !== null && <span className="tag">{label}</span>}</div>
    </li>
  )
}

const OPEN_KEY = 'even-keel.outside.open.'

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
