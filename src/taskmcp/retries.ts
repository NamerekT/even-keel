import type { Queryable } from '../storage/database.js'

const RETRIES_KEPT = 200

/** A position whose create was begun with this marker and whose id was not saved: the task may be in the tracker. */
export interface StartedTask {
  at: number
  marker: string
}

export interface Retry {
  ids: string[]
  started: StartedTask | null
  /** Saves the position and its marker before the task is created (BTN-905). */
  start(at: number, marker: string): Promise<void>
  /** Saves `ids` and clears `started`. */
  save(): Promise<void>
}

/** The progress of a call without `retry`: nothing is saved. */
export function unsavedRetry(): Retry {
  return { ids: [], started: null, start: async () => {}, save: async () => {} }
}

/** Durable progress of tasks_create; calls of the same project and retry key run one at a time. */
export class TaskRetries {
  private readonly pending = new Map<string, Promise<unknown>>()

  constructor(private readonly db: Queryable) {}

  async run<T>(project: string, key: string, call: (retry: Retry) => Promise<T>): Promise<T> {
    const identity = JSON.stringify([project, key])
    const previous = this.pending.get(identity) ?? Promise.resolve()
    const work = previous.catch(() => {}).then(async () => {
      const { rows } = await this.db.query<{ ids: string; started: string | null }>(
        `insert into task_retries (project_id, retry_key, ids) values ($1, $2, '[]')
           on conflict (project_id, retry_key) do update set retry_key = excluded.retry_key returning ids, started`,
        [project, key],
      )
      const retry: Retry = {
        ids: JSON.parse(rows[0]!.ids) as string[],
        started: rows[0]!.started === null ? null : (JSON.parse(rows[0]!.started) as StartedTask),
        start: async (at, marker) => {
          await this.db.query('update task_retries set started = $3 where project_id = $1 and retry_key = $2', [project, key, JSON.stringify({ at, marker })])
          retry.started = { at, marker }
        },
        save: async () => {
          await this.db.query('update task_retries set ids = $3, started = null where project_id = $1 and retry_key = $2', [project, key, JSON.stringify(retry.ids)])
          retry.started = null
        },
      }
      return call(retry)
    })
    this.pending.set(identity, work)
    let failed = false
    try {
      return await work
    } catch (error) {
      failed = true
      throw error
    } finally {
      if (this.pending.get(identity) === work) this.pending.delete(identity)
      // Keep in-flight batches until their calls settle, even with more than 200 calls at once.
      if (this.pending.size === 0) {
        try {
          await this.db.query(`delete from task_retries where position not in (select position from task_retries order by position desc limit ${RETRIES_KEPT})`)
        } catch (error) {
          if (!failed) throw error
        }
      }
    }
  }
}
