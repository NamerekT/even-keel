import { randomUUID } from 'node:crypto'
import type { Queryable } from '../storage/database.js'
import type { ExportPlan } from '../tracker/export.js'
import type { TransferCheck, TransferDirection, TransferReport, TransferSummary } from '../tracker/transfer-check.js'

interface ReportRow {
  id: string
  project_id: string
  direction: TransferDirection
  tracker: string
  place: string
  key: string
  source_key: string | null
  closed: boolean
  history: boolean
  started_at: string
  finished_at: string | null
  switched_at: string
  plan: string
  checked: string
  matched: boolean
}

/** The reports of finished transfers (step 69, BTN-1291): one a switch, in either direction, gone only with the project. */
export class TransferReports {
  constructor(private readonly db: Queryable) {}

  async add(report: Omit<TransferReport, 'id'>): Promise<TransferReport> {
    const id = `transfer-${randomUUID()}`
    await this.db.query(
      `insert into tracker_transfers (id, project_id, direction, tracker, place, key, source_key, closed, history, started_at, finished_at, switched_at, plan, checked, matched)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        report.project,
        report.direction,
        report.tracker,
        report.place,
        report.key,
        report.sourceKey,
        report.closed,
        report.history,
        report.startedAt,
        report.finishedAt,
        report.switchedAt,
        JSON.stringify(report.plan),
        JSON.stringify(report.check),
        report.matched,
      ],
    )
    return { ...report, id }
  }

  /** The project's transfers, the latest first. */
  async list(project: string): Promise<TransferSummary[]> {
    const { rows } = await this.db.query<ReportRow>('select * from tracker_transfers where project_id = $1 order by switched_at desc, id', [project])
    return rows.map((row) => {
      const report = reportOf(row)
      return { id: report.id, direction: report.direction, tracker: report.tracker, switchedAt: report.switchedAt, matched: report.matched, tasks: report.plan.counts.tasks }
    })
  }

  /** `null` — no such report. */
  async read(id: string): Promise<TransferReport | null> {
    const { rows } = await this.db.query<ReportRow>('select * from tracker_transfers where id = $1', [id])
    return rows[0] === undefined ? null : reportOf(rows[0])
  }
}

function reportOf(row: ReportRow): TransferReport {
  return {
    id: row.id,
    project: row.project_id,
    direction: row.direction,
    tracker: row.tracker,
    place: row.place,
    key: row.key,
    sourceKey: row.source_key,
    closed: row.closed,
    history: row.history,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    switchedAt: row.switched_at,
    plan: JSON.parse(row.plan) as ExportPlan,
    check: JSON.parse(row.checked) as TransferCheck,
    matched: row.matched,
  }
}
