import { useEffect, useState } from 'react'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { PencilIcon } from '../ui/icons.js'
import { ComponentEditor, ComponentRemoval, type ComponentRow } from './ComponentDialogs.js'
import { keepRows, useKeptRows } from './keptRows.js'
import { Section } from './settingsParts.js'
import './componentList.css'

/** The first line of a Markdown description as plain text: no heading or list mark. */
export function firstLine(description: string): string {
  const line = description.split('\n').find((each) => each.trim() !== '') ?? ''
  return line.trim().replace(/^(#+|[-*+]|\d+[.)])\s+/, '')
}

type Open = { kind: 'edit'; row: ComponentRow | null } | { kind: 'remove'; row: ComponentRow } | null

const ROUTE = 'builtin/components'

/**
 * Asks for the project's components when its source window opens (`on`), off the page's loader, so the tab opened
 * later finds its rows and the window does not shrink to "Loading…" on the switch (BTN-1499). A failure is the tab's.
 */
export function useEarlyComponents(project: string, on: boolean): void {
  const { read } = useLive()
  useEffect(() => {
    if (on) keepRows(read, ROUTE, project).catch(() => {})
  }, [project, on])
}

/**
 * "Components" of the built-in tracker's window (BTN-1288): the project's components by name with their task counts. A
 * row opens its editor; the chain does not read them, a person sorts tasks by them on the card.
 */
export function ComponentList({ project }: { project: string }) {
  const { rows, failure, load } = useKeptRows<ComponentRow>(ROUTE, project)
  const [open, setOpen] = useState<Open>(null)

  const done = () => {
    setOpen(null)
    void load()
  }
  const count = (value: number) => (value === 0 ? <span className="component-list__none">{t.components.none}</span> : value)

  return (
    <Section
      title={t.components.title}
      hint={t.components.hint}
      className="component-list"
      aside={
        <button type="button" className="button button--small" onClick={() => setOpen({ kind: 'edit', row: null })}>
          {t.components.add}
        </button>
      }
    >
      {rows === null && failure === null && <p className="placeholder">{t.components.loading}</p>}
      {rows !== null && rows.length === 0 && <p className="placeholder">{t.components.empty}</p>}
      {rows !== null && rows.length > 0 && (
        <div className="component-list__table">
          <div className="component-list__head" aria-hidden="true">
            <span>{t.components.name}</span>
            <span className="component-list__description">{t.components.description}</span>
            <span className="component-list__count">{t.components.open}</span>
            <span className="component-list__count">{t.components.total}</span>
            <span />
          </div>
          <ul className="component-list__rows">
            {rows.map((row) => {
              const line = firstLine(row.description)
              return (
                <li key={row.id}>
                  <button type="button" className="component-list__row" aria-label={t.components.edit(row.name)} onClick={() => setOpen({ kind: 'edit', row })}>
                    <span className="component-list__name">
                      <span className="component-list__label">{row.name}</span>
                      {row.total === 0 && <span className="tag">{t.components.fresh}</span>}
                    </span>
                    <span className="component-list__description">{line === '' ? <span className="component-list__none">{t.components.none}</span> : line}</span>
                    <span className="component-list__count component-list__count--open">{count(row.open)}</span>
                    <span className="component-list__count">{count(row.total)}</span>
                    <span className="component-list__pencil" aria-hidden="true">
                      <PencilIcon />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      {open?.kind === 'edit' && (
        <ComponentEditor
          project={project}
          row={open.row}
          onRemove={open.row === null ? undefined : () => setOpen({ kind: 'remove', row: open.row! })}
          onDone={done}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'remove' && (
        <ComponentRemoval project={project} row={open.row} others={(rows ?? []).filter((each) => each.id !== open.row.id)} onDone={done} onClose={() => setOpen(null)} />
      )}
    </Section>
  )
}
