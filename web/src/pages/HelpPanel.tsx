import { useEffect, useRef } from 'react'
import { t } from '../i18n/index.js'
import { Card, SectionLabel } from '../ui/blocks.js'
import { Lamp } from '../ui/Lamp.js'
import type { BlockLamp, ChainBlock } from '../state.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { HeaderSigns, ProjectSigns, SessionSigns, TabSigns, TaskSigns, PrioritySigns } from './HelpSamples.js'
import { reorderable } from './useChainDrag.js'
import './pageHelp.css'

/** The address hash that opens the help panel; a task id never equals it. */
export const HELP_HASH = 'help'
const LEGEND = ['done', 'working', 'waiting', 'handoff', 'stopped', 'error', 'ahead', 'backlog', 'canceled', 'fixed'] as const satisfies readonly BlockLamp[]
const HELP_CLASS: Record<ChipLook, string> = { tag: 'tag tag--help', tab: 'side-tab side-tab--help', seg: SEG_CLASS }

export function HelpChip({ open, look = 'tag', onToggle }: { open: boolean; look?: ChipLook; onToggle: () => void }) {
  return (
    <button type="button" className={HELP_CLASS[look]} aria-expanded={open} aria-label={t.help.title} title={t.help.title} onClick={onToggle}>
      ?
    </button>
  )
}

interface Props {
  blocks: ChainBlock[]
  ci: boolean
  narrow: boolean
  onClose: () => void
}

/** A reference grouped by where each sample appears on the project page. */
export function HelpPanel({ blocks, ci, narrow, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel page-help" aria-label={t.help.title}>
      <header className="panel__head">
        <h2 className="panel__task">{t.help.title}</h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>×</button>
      </header>
      <Card title={t.help.head} className="page-help__section">
        <ul className="page-help__signs"><HeaderSigns narrow={narrow} /></ul>
      </Card>
      <Card title={t.help.project} className="page-help__section">
        <ul className="page-help__signs"><ProjectSigns /></ul>
      </Card>
      <Card title={t.help.tabs} className="page-help__section">
        <ul className="page-help__signs"><TabSigns ci={ci} narrow={narrow} /></ul>
      </Card>
      <Card title={t.help.task} className="page-help__section">
        <SectionLabel>{t.help.chain}</SectionLabel>
        <ul className="page-help__signs">
          {LEGEND.map((lamp) => <li key={lamp} className="page-help__mark"><Lamp lamp={lamp} /><span>{t.chain.legend[lamp]}</span></li>)}
        </ul>
        <ul className="page-help__signs"><TaskSigns blocks={blocks} /></ul>
        <SectionLabel>{t.help.priority}</SectionLabel>
        <ul className="page-help__signs"><PrioritySigns blocks={blocks} /></ul>
        <ul className="page-help__hints">
          <li>{t.help.open}</li>
          <li>{t.chain.linksHint}</li>
          {blocks.some(reorderable) && <li>{t.chain.dragHint}</li>}
        </ul>
      </Card>
      <Card title={t.help.session} className="page-help__section">
        <ul className="page-help__signs"><SessionSigns /></ul>
      </Card>
    </aside>
  )
}
