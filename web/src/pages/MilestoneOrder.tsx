import { useEffect, useState } from 'react'
import type { SequencedMilestone } from '../../../src/chain/milestone-sequence.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { projectPages } from '../state.js'
import { useDragList } from '../ui/useDragList.js'
import { Section } from './settingsParts.js'
import './milestoneOrder.css'

/**
 * "Milestone order" of the project's tracker window (BTN-792): the live milestones in the order the chain goes by.
 * Automatic until the first drag, which saves the whole list as the project's own; "Back to automatic" drops it.
 */
export function MilestoneOrder({ project, milestones, saved }: { project: string; milestones: readonly SequencedMilestone[]; saved: readonly string[] }) {
  const { send, sending, failure } = useCommand()
  const { state } = useLive()
  // Where milestones are given: the project's main tracker.
  const home = state === null ? undefined : projectPages(state, project)[0]
  const served = milestones.map((each) => each.label)
  const [pending, setPending] = useState<string[] | null>(null)
  const manual = saved.length > 0
  const order = pending ?? served
  const fresh = new Set(pending === null ? milestones.filter((each) => each.fresh).map((each) => each.label) : [])

  useEffect(() => setPending(null), [served.join('\n'), manual])

  const save = async (next: string[]) => {
    setPending(next)
    if (!(await send('project/milestone-order', { project, order: next }))) setPending(null)
  }
  const list = useDragList<HTMLOListElement>(order, sending, (next) => void save(next))

  return (
    <Section
      title={t.settings.milestoneOrder}
      hint={t.settings.milestoneOrderHint}
      className="milestone-order"
      aside={
        manual ? (
          <button type="button" className="button button--small" disabled={sending} onClick={() => void save([])}>
            {t.settings.milestoneOrderBack}
          </button>
        ) : (
          <span className="tag">{t.settings.milestoneOrderAuto}</span>
        )
      }
    >
      {order.length === 0 ? (
        <div className="milestone-order__empty">
          <p>{t.settings.milestoneOrderEmpty}</p>
          {home !== undefined && (
            <a className="button button--small" href={home.url} target="_blank" rel="noreferrer">
              {t.project.openIn(home.tracker)}
            </a>
          )}
        </div>
      ) : (
        <ol ref={list.listRef} className={listClass(list.dragging, list.landing)}>
          {order.map((label, index) => {
            const offset = list.offsetOf(index)
            return (
              <li
                key={label}
                className={list.isDragged(index) ? 'milestone-order__row milestone-order__row--dragged' : 'milestone-order__row'}
                style={offset === 0 ? undefined : { transform: `translateY(${offset}px)` }}
              >
                <button type="button" className="milestone-order__handle" aria-label={t.settings.milestoneOrderMove(label)} disabled={order.length < 2} {...list.handle(index)}>
                  ⠿
                </button>
                <span className="milestone-order__place">{index + 1}</span>
                <span className="milestone-order__label">{label}</span>
                {fresh.has(label) && <span className="tag">{t.settings.milestoneOrderNew}</span>}
              </li>
            )
          })}
        </ol>
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </Section>
  )
}

function listClass(dragging: boolean, landing: boolean): string {
  if (dragging) return 'milestone-order__list milestone-order__list--dragging'
  return landing ? 'milestone-order__list milestone-order__list--landing' : 'milestone-order__list'
}
