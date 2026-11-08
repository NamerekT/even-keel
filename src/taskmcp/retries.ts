import type { Queryable } from '../storage/database.js'

const RETRIES_KEPT = 200

export interface Retry {
  ids: string[]
  save(): Promise<void>
}

/** Durable progress of tasks_create; calls of the same project and retry key run one at a time. */
export class TaskRetries {
  private readonly pending = new Map<string, Promise<unknown>>()

  constructor(private readonly db: Queryable) {}

  async run<T>(project: string, key: string, call: (retry: Retry) => Promise<T>): Promise<T> {
    const identity = JSON.stringify([project, key])
    const previous = this.pending.get(identity) ?? Promise.resolve()
    const work = previous.catch(() => {}).then(async () => {
      const { rows } = await this.db.query<{ ids: string }>(
        `insert into task_retries (project_id, retry_key, ids) values ($1, $2, '[]')
           on conflict (project_id, retry_key) do update set retry_key = excluded.retry_key returning ids`,
        [project, key],
      )
      const ids = JSON.parse(rows[0]!.ids) as string[]
      return call({
        ids,
        save: async () => {
          await this.db.query('update task_retries set ids = $3 where project_id = $1 and retry_key = $2', [project, key, JSON.stringify(ids)])
        },
      })
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
