import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { isOwnName } from '../../../src/chain/fix.js'
import { t } from '../i18n/index.js'
import type { ChainBlock } from '../state.js'
import type { ArchiveView } from '../ui/archive.js'
import { ResetsBadge } from '../ui/BlockMetrics.js'
import { Lamp } from '../ui/Lamp.js'
import { ArchiveCounts, Divider, SubtasksChip } from './ChainDivider.js'
import { Forge } from './Forge.js'
import type { ArchiveBusy } from './useArchivePages.js'

interface Props {
  archive: ArchiveView<ChainBlock>
  /** The feed's view switch, at the right of its top row (BTN-1041). */
  switcher: ReactNode
  bump: number | undefined
  focus: string
  /** The address search a row's link keeps. */
  rowSearch: string | undefined
  /** The button whose page of older rows is on its way (BTN-1445): it spins, the page's loader does not. */
  busy: ArchiveBusy
  onOpen: () => void
  onMore: () => void
  onFold: () => void
}

/** The archive above the chain: its line, folded or with its unfolded pages under it. */
export function ChainArchive({ archive, switcher, bump, focus, rowSearch, busy, onOpen, onMore, onFold }: Props) {
  if (archive.shown === 0) {
    return (
      (archive.hidden > 0 || switcher !== undefined) && (
        <TopRow switcher={switcher}>
          {archive.hidden > 0 && (
            <Divider
              name={t.chain.archive}
              count={<ArchiveCounts tasks={archive.hidden - archive.hiddenFixes} fixes={archive.hiddenFixes} />}
              hidden
              bump={bump}
              toggle={{ expanded: false, title: t.chain.openArchive, run: onOpen, busy: busy === 'open' }}
            />
          )}
        </TopRow>
      )
    )
  }
  return (
    <section className="chain__archive">
      <TopRow switcher={switcher}>
        <Divider
          name={t.chain.archive}
          count={
            archive.hidden > 0
              ? t.chain.archiveShown(archive.shown, archive.shown + archive.hidden)
              : <ArchiveCounts tasks={archive.shown - archive.shownFixes} fixes={archive.shownFixes} />
          }
          bump={bump}
          toggle={{ expanded: true, title: t.chain.foldArchive, run: onFold }}
          action={
            archive.hidden > 0 && (
              <button
                type="button"
                className="chain__more"
                title={t.chain.loadMore(archive.next, archive.hidden)}
                aria-busy={busy === 'more' ? 'true' : undefined}
                onClick={onMore}
              >
                {t.chain.archiveMore(archive.next)}
              </button>
            )
          }
        />
      </TopRow>
      <ol className="chain__archived">
        {archive.archived.map((block, index) => (
          <ArchivedRow
            key={block.id}
            block={block}
            search={rowSearch}
            milestone={block.milestone !== archive.archived[index - 1]?.milestone ? block.milestone : null}
            focused={block.id === focus}
          />
        ))}
      </ol>
    </section>
  )
}

/** A row of the unfolded archive: one quiet line, its context resets and its milestone, named only where the milestone changes. */
function ArchivedRow({ block, search, milestone, focused }: { block: ChainBlock; search: string | undefined; milestone: string | null; focused: boolean }) {
  return (
    <li id={block.id} className={`archived archived--${block.lamp}${focused ? ' archived--focus' : ''}`} data-block={block.id}>
      <span className="archived__head">
        <Lamp lamp={block.lamp} />
        <Link to={{ search, hash: block.id }} className="archived__key" draggable={false} aria-current={focused ? 'true' : undefined}>
          {block.id}
        </Link>
      </span>
      <span className="archived__title" title={block.title ?? undefined}>
        {block.title}
        {isOwnName(block.id) && <Forge lamp={block.lamp} />}
      </span>
      <span className="archived__side">
        {block.subtasks !== undefined && <SubtasksChip family={block.id} subtasks={block.subtasks} />}
        <ResetsBadge sessions={block.sessions} />
        {milestone !== null && <span className="archived__milestone">{milestone}</span>}
      </span>
    </li>
  )
}

/** The feed's first row: the archive line, the view switch at its right. */
function TopRow({ switcher, children }: { switcher: ReactNode; children: ReactNode }) {
  if (switcher === undefined) return children
  return (
    <div className="chain__top">
      {children}
      <span className="chain__switch">{switcher}</span>
    </div>
  )
}
