import { useState, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { AccountName, Ring } from '../layout/AccountBlock.js'
import { BurgerIcon } from '../layout/Menu.js'
import { QueueContents } from '../layout/Queue.js'
import { GearIcon } from '../layout/Status.js'
import { useLive } from '../live/context.js'
import { isClosedLamp, type ChainBlock } from '../state.js'
import { CacheRing } from '../ui/BlockMetrics.js'
import { ChangelogIcon, HandoffIcon, KeyIcon, LockIcon, RefreshIcon, SlidersIcon, StackIcon } from '../ui/icons.js'
import { estimateShare, isRework, railsOf } from '../ui/look.js'
import { QuestionsChip } from '../ui/QuestionsChip.js'
import { seriesStyle } from '../ui/series.js'
import { Forge } from './Forge.js'
import { LockIcon as BlockLockIcon, PlayIcon } from './ChainList.js'

function Sign({ sample, wide = false, children }: { sample: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <li className={`page-help__sign${wide ? ' page-help__sign--wide' : ''}`}>
      <span className="page-help__sample" aria-hidden="true" inert>{sample}</span>
      <span>{children}</span>
    </li>
  )
}

export function HeaderSigns({ narrow }: { narrow: boolean }) {
  const { state } = useLive()
  if (narrow) return <>
    <Sign sample={<span className="waiting__count">2</span>}>{t.help.signs.waiting}</Sign>
    <Sign sample={<BurgerIcon />}>{t.help.signs.menu}</Sign>
    <Sign sample={<span className="page-help__bars" />}>{t.help.signs.bars}</Sign>
  </>
  const kind = state === null || state.chain.active.length === 0 ? 'idle' : state.chain.active.every((chain) => chain.paused) ? 'paused' : 'running'
  return <>
    {state !== null && <>
      <Sign wide sample={<span className="hblock work-block"><span className={`queue-toggle queue-toggle--${kind}`}><QueueContents state={state} /></span></span>}>{t.help.signs.queue}</Sign>
      <Sign wide sample={<span className="hblock"><AccountName account={state.account} /></span>}>{t.help.signs.account}</Sign>
    </>}
    <Sign sample={<span className="limit--warm"><Ring percent={85} /></span>}>{t.help.signs.limit}</Sign>
    <Sign sample={<span className="account-block__mini" style={seriesStyle(2)}><Ring percent={40} /></span>}>{t.help.signs.others}</Sign>
    <Sign sample={<GearIcon />}>{t.help.signs.gear}</Sign>
  </>
}

export function ProjectSigns() {
  return <>
    <Sign sample={<QuestionsChip count={2} />}>{t.help.signs.questions}</Sign>
    <Sign wide sample={<span className="project__read"><span className="project__refresh"><RefreshIcon /></span><span className="project__read-at">{t.help.samples.updated}</span></span>}>{t.help.signs.read}</Sign>
  </>
}

export function TabSigns({ ci, narrow }: { ci: boolean; narrow: boolean }) {
  return <>
    {ci && <Sign sample={<span className="ci--success"><span className="ci-dot" /></span>}>{t.help.signs.ci}</Sign>}
    <Sign sample={narrow ? <StackIcon /> : <span className="side-tabs"><span className="side-tab"><StackIcon />{t.project.backlog(3)}</span></span>} wide={!narrow}>{t.help.signs.backlog}</Sign>
    <Sign sample={narrow ? <SlidersIcon /> : <span className="side-tabs"><span className="side-tab"><SlidersIcon />{t.header.settings}</span></span>} wide={!narrow}>{t.help.signs.settings}</Sign>
    <Sign sample={<span className="side-tab side-tab--help">?</span>}>{t.help.signs.help}</Sign>
  </>
}

export function TaskSigns({ blocks }: { blocks: ChainBlock[] }) {
  const [until] = useState(() => new Date(Date.now() + 240_000).toISOString())
  const model = blocks.flatMap((block) => block.runLabels)[0] ?? 'Claude | opus'
  return <>
    <Sign sample={<span className="chain"><span className="block__number block__number--medium">2</span></span>}>{t.help.card.number}</Sign>
    <Sign sample={<span className="chain page-help__current"><PlayIcon /></span>}>{t.help.card.current}</Sign>
    <Sign sample={<CacheRing cache={{ ttl: '5m', until }} />}>{t.help.card.cache}</Sign>
    <Sign sample={<span className="links__count"><LockIcon /><span className="links__number">2</span></span>}>{t.help.card.blockers}</Sign>
    <Sign sample={<span className="links__count"><KeyIcon /><span className="links__number">3</span></span>}>{t.help.card.dependents}</Sign>
    <Sign sample={<span className="chain"><BlockLockIcon /></span>}>{t.chain.lockedHint}</Sign>
    <Sign wide sample={<span className="tag">{model}</span>}>{t.help.card.model}</Sign>
    <Sign sample={<ChangelogIcon />}>{t.help.card.milestone}</Sign>
    <Sign wide sample={<><Forge lamp="working" /><Forge lamp="fixed" /></>}>{t.help.card.forge}</Sign>
  </>
}

export function PrioritySigns({ blocks }: { blocks: ChainBlock[] }) {
  const open = blocks.filter((block) => !isClosedLamp(block.lamp))
  return <>
    {(['urgent', 'high', 'low'] as const).map((priority) => <Sign key={priority} sample={<span className="chain"><span className={`block__number block__number--${priority}`}>2</span></span>}>{t.chain.shapes[priority]}</Sign>)}
    {open.some((block) => isRework(block.labels)) && <Sign sample={<span className="page-help__shape page-help__shape--rework" />}>{t.chain.shapes.rework}</Sign>}
    {railsOf(blocks).size > 0 && <Sign sample={<span className="page-help__shape page-help__shape--family" />}>{t.chain.shapes.family}</Sign>}
    {open.some((block) => estimateShare(block.estimate) !== null) && <Sign wide sample={<span className="chain"><span className="page-help__estimate"><span className="block__estimate" /></span></span>}>{t.chain.shapes.estimate}</Sign>}
  </>
}

export function SessionSigns() {
  return <>
    <Sign wide sample={<span className="block__now page-help__action"><span className="block__action">{t.help.samples.action}</span><span className="block__now-value">42%</span></span>}>{t.help.card.action}</Sign>
    <Sign sample={<span className="block__resets"><HandoffIcon />2</span>}>{t.help.card.resets}</Sign>
    <Sign sample={<span className="block__now-value">42%</span>}>{t.help.card.context}</Sign>
  </>
}
