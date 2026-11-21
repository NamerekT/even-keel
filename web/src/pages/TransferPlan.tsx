import type { ReactNode } from 'react'
import type { ExportCounts, ExportLossKind, ExportPlan, ExportStatusRow } from '../../../src/tracker/export.js'
import type { CheckRow, TransferCheck, TransferDirection } from '../../../src/tracker/transfer-check.js'
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

/**
 * What moves, a tile a kind; the links split by kind in the tip of their label. The import's counts (`ImportCounts`)
 * add the changes and the components, which no export target takes.
 */
export function TransferMoves({ counts, title = t.transfer.moves }: { counts: ExportCounts & { changes?: number; components?: number }; title?: string }) {
  const links = counts.blocks + counts.relates + counts.subtasks
  const words = t.transfer.counts
  return (
    <TransferBlock title={title}>
      <TileGrid className="transfer__tiles">
        <Tile label={words.tasks} value={count(counts.tasks)} />
        <Tile label={words.comments} value={count(counts.comments)} />
        {counts.changes !== undefined && <Tile label={t.transfer.imports.counts.changes} value={count(counts.changes)} />}
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
        {counts.components !== undefined && <Tile label={t.transfer.imports.counts.components} value={count(counts.components)} />}
      </TileGrid>
    </TransferBlock>
  )
}

/** Of the import's losses, those whose names are other projects' task ids: only their count of this project's tasks shows. */
const IDS_ONLY = new Set<ExportLossKind>(['links', 'parent'])

/**
 * What the target leaves behind, a line per kind: its names where they are names, the tasks in a tip of their count.
 * An import names its kinds its own way where they differ (`t.transfer.imports.kinds`).
 */
export function Losses({
  plan,
  recheck,
  checking,
  direction = 'export',
  title = t.transfer.losses,
  none = direction === 'export' ? t.transfer.lossesNone : t.transfer.imports.lossesNone,
}: {
  plan: ExportPlan
  recheck: (() => void) | null
  checking: boolean
  direction?: TransferDirection
  title?: string
  none?: string
}) {
  const own = direction === 'import' ? t.transfer.imports : null
  const kindOf = (kind: ExportLossKind) => (own?.kinds as Partial<Record<ExportLossKind, string>> | undefined)?.[kind] ?? t.transfer.kinds[kind]
  const tipOf = (kind: ExportLossKind) => (own?.kindTips as Partial<Record<ExportLossKind, string>> | undefined)?.[kind] ?? t.transfer.kindTips[kind]
  const named = (kind: ExportLossKind) => own === null || !IDS_ONLY.has(kind)
  // An import's milestone loss names the fields the tracker does not keep.
  const nameOf = (kind: ExportLossKind, name: string) =>
    own !== null && kind === 'milestones' ? ((own.milestoneFields as Partial<Record<string, string>>)[name] ?? name) : name
  return (
    <section className="transfer__losses" aria-label={title}>
      <header className="transfer__losses-head">
        <h3 className="transfer__losses-title">{title}</h3>
        {recheck !== null && (
          <button type="button" className="button button--small" disabled={checking} onClick={recheck}>
            {t.transfer.recheck}
          </button>
        )}
      </header>
      {plan.losses.length === 0 ? (
        <p className="transfer__none">{none}</p>
      ) : (
        <ul className="transfer__loss-list">
          {plan.losses.map((loss) => (
            <li key={loss.kind} className="transfer__loss">
              <Tipped tip={tipOf(loss.kind)} focusable inline align="start" className="transfer__kind">
                {kindOf(loss.kind)}
              </Tipped>
              {loss.names.length > 0 && named(loss.kind) && <span className="transfer__names">{loss.names.map((name) => nameOf(loss.kind, name)).join(', ')}</span>}
              {loss.tasks.length > 0 && (
                <Tipped tip={t.transfer.lossTip(loss.tasks)} focusable inline className="transfer__count">
                  {t.transfer.lossTasks(loss.tasks.length)}
                </Tipped>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The kinds of the check that did not match, as the table names them. */
export const shortKinds = (check: TransferCheck): string[] => check.rows.filter((row) => !rowMatched(row)).map((row) => t.transfer.checkKinds[row.kind])

const rowMatched = (row: CheckRow) => row.tasks.length === 0 && row.target >= row.source

/** The page's twin of the service's `checkMatched`: that module reads the trackers and is no client code. */
export const checkMatched = (check: TransferCheck): boolean => check.rows.every(rowMatched)

/**
 * The check at the end of a transfer (BTN-1291): a row a kind, "Here" against the other tracker — the source first, so
 * an import reads the other way round; a row short of something is red, its tasks under the "!". The files an import's
 * source has no bytes of stand in a line under the table, each under its tip (BTN-1454).
 */
export function TransferCheckTable({ check, direction, tracker }: { check: TransferCheck; direction: TransferDirection; tracker: string }) {
  const gone = check.rows.flatMap((row) => row.gone ?? [])
  const heads = [t.transfer.statusHere, t.transfer.statusThere(tracker)]
  const [first, second] = direction === 'export' ? heads : [heads[1]!, heads[0]!]
  return (
    <TransferBlock title={t.transfer.check} help={t.transfer.checkTip}>
      <table className="transfer__table transfer__table--check">
        <thead>
          <tr>
            <th scope="col" aria-label={t.transfer.check} />
            <th scope="col" className="transfer__num">
              {first}
            </th>
            <th scope="col" className="transfer__num">
              {second}
            </th>
            <th scope="col" aria-label={t.transfer.checkOk} />
          </tr>
        </thead>
        <tbody>
          {check.rows.map((row) => {
            const ok = rowMatched(row)
            return (
              <tr key={row.kind} className={ok ? undefined : 'transfer__short'}>
                <td>{t.transfer.checkKinds[row.kind]}</td>
                <td className="transfer__num">{count(row.source)}</td>
                <td className="transfer__num transfer__got">{count(row.target)}</td>
                <td className="transfer__mark">
                  {ok ? (
                    <span className="transfer__ok" role="img" aria-label={t.transfer.checkOk}>
                      ✓
                    </span>
                  ) : (
                    <Tipped tip={row.tasks.length === 0 ? t.transfer.reportMismatched : t.transfer.checkShort(row.tasks)} focusable inline align="end" className="transfer__bad">
                      !
                    </Tipped>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {gone.length > 0 && (
        <p className="transfer__none">
          <Tipped tip={t.transfer.checkGoneTip(gone.map((each) => `${each.task}: ${each.name}`))} focusable inline align="start" className="transfer__kind">
            {t.transfer.checkGone(gone.length, tracker)}
          </Tipped>
        </p>
      )}
    </TransferBlock>
  )
}

/**
 * Each status of the moving tasks, how many have it, and the one they get in `tracker`; an import's rows are the source's
 * statuses, so the table reads "In <tracker> | Tasks | Becomes".
 */
export function TransferStatuses({ rows, tracker, direction = 'export' }: { rows: readonly ExportStatusRow[]; tracker: string; direction?: TransferDirection }) {
  if (rows.length === 0) return null
  const [from, to] = direction === 'export' ? [t.transfer.statusHere, t.transfer.statusThere(tracker)] : [t.transfer.statusThere(tracker), t.transfer.imports.statusBecomes]
  return (
    <TransferBlock title={t.transfer.statuses} help={t.transfer.statusesTip}>
      <table className="transfer__table">
        <thead>
          <tr>
            <th scope="col">{from}</th>
            <th scope="col" className="transfer__num">
              {t.transfer.statusTasks}
            </th>
            <th scope="col">{to}</th>
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
