import type { ReactNode } from 'react'
import type { ExportCounts, ExportStatusRow } from '../../../src/tracker/export.js'
import { language, t } from '../i18n/index.js'
import { Tile, TileGrid } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import { HelpTip } from './settingsParts.js'
import { StatusDot } from './StatusDot.js'

const count = (value: number) => value.toLocaleString(language)

/** A block of the transfer window: its 14 px title, a help tip after it where it has one. */
export function TransferBlock({ title, help, className, children }: { title: string; help?: string; className?: string; children: ReactNode }) {
  return (
    <section className={className === undefined ? 'transfer__block' : `transfer__block ${className}`} aria-label={title}>
      <h3 className="transfer__block-title">
        {title}
        {help !== undefined && <HelpTip text={help} align="start" />}
      </h3>
      {children}
    </section>
  )
}

/** What moves, a tile a kind; the links split by kind in the tip of their label. */
export function TransferMoves({ counts }: { counts: ExportCounts }) {
  const links = counts.blocks + counts.relates + counts.subtasks
  const words = t.transfer.counts
  return (
    <TransferBlock title={t.transfer.moves}>
      <TileGrid className="transfer__tiles">
        <Tile label={words.tasks} value={count(counts.tasks)} />
        <Tile label={words.comments} value={count(counts.comments)} />
        <Tile label={words.files} value={count(counts.files)} />
        <Tile
          label={
            <Tipped
              tip={[t.transfer.linkKinds.blocks(counts.blocks), t.transfer.linkKinds.relates(counts.relates), t.transfer.linkKinds.subtasks(counts.subtasks)].map((line) => (
                <span key={line}>{line}</span>
              ))}
              focusable
              inline
              align="start"
              className="transfer__dotted"
            >
              {words.links}
            </Tipped>
          }
          value={count(links)}
        />
        <Tile label={words.milestones} value={count(counts.milestones)} />
        <Tile label={words.labels} value={count(counts.labels)} />
      </TileGrid>
    </TransferBlock>
  )
}

/** Each status of the moving tasks, how many have it, and the one they get in `tracker`. */
export function TransferStatuses({ rows, tracker }: { rows: readonly ExportStatusRow[]; tracker: string }) {
  if (rows.length === 0) return null
  return (
    <TransferBlock title={t.transfer.statuses} help={t.transfer.statusesTip}>
      <table className="transfer__table">
        <thead>
          <tr>
            <th scope="col">{t.transfer.statusHere}</th>
            <th scope="col" className="transfer__num">
              {t.transfer.statusTasks}
            </th>
            <th scope="col">{t.transfer.statusThere(tracker)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.category} ${row.name}`}>
              <td>
                <span className="transfer__status">
                  <StatusDot status={row} />
                  {row.name}
                </span>
              </td>
              <td className="transfer__num">{count(row.tasks)}</td>
              <td>
                {row.target === null ? (
                  <span className="transfer__muted">{t.transfer.statusDefault}</span>
                ) : (
                  <span className="transfer__status">
                    <StatusDot status={row.target} />
                    {row.target.name}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TransferBlock>
  )
}
