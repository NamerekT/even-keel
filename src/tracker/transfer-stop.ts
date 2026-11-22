import { notice, type Notice } from '../notice/notice.js'
import { errorText } from './error-text.js'
import { sourceBusy } from './import-retry.js'

/**
 * Where an import or a copy stopped (BTN-1455): each of its stages wraps what it reads and writes in `atStage`, and the
 * failure's message names the task, the stage and what it was on, with a reason that is never blank.
 */

export type TransferStage = 'read' | 'components' | 'milestones' | 'create' | 'links' | 'attach' | 'journal' | 'history' | 'fields' | 'mark' | 'check'

/** What the stage read or wrote when it stopped; `comment` counts from 1. */
export type TransferItem =
  | { kind: 'file'; name: string }
  | { kind: 'comment'; number: number; of: number }
  | { kind: 'milestone'; name: string }
  | { kind: 'component'; name: string }

export interface TransferPlace {
  stage: TransferStage
  /** The task's id as its tracker shows it (`ABC-12`); `null` — a stage of the whole project. */
  task: string | null
  item?: TransferItem
}

export class TransferStop extends Error {
  constructor(
    readonly place: TransferPlace,
    cause: unknown,
  ) {
    super(`${place.task === null ? '' : `${place.task}: `}${place.stage}${place.item === undefined ? '' : ` ${JSON.stringify(place.item)}`}: ${errorText(cause)}`, { cause })
    this.name = 'TransferStop'
  }
}

/** Runs `body`, its failure a `TransferStop` at `place`; one thrown from a narrower place inside is kept as it is. */
export async function atStage<T>(place: TransferPlace, body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (error) {
    throw error instanceof TransferStop ? error : new TransferStop(place, error)
  }
}

function stopOf(error: unknown): TransferStop | null {
  for (let each = error, depth = 0; each instanceof Error && depth < 10; each = each.cause, depth += 1) {
    if (each instanceof TransferStop) return each
  }
  return null
}

/**
 * The extras of a failed import's or copy's notice: where it stopped as the cause (`transfer.stop`, the task with its
 * link where `url` gives one) and the reason as the detail; a failure outside the stages names the reason alone.
 */
export function stopExtras(error: unknown, url: (task: string) => string | null = () => null): { cause: Notice; detail: string } {
  const stop = stopOf(error)
  // A source that refused every try (BTN-1460): the stop says it was overloaded, the detail is its last refusal.
  const busy = sourceBusy(error)
  const overloaded = busy === null ? undefined : notice('transfer.busy', { tries: busy.tries })
  const detail = errorText(busy?.cause ?? stop?.cause ?? error)
  if (stop === null) return { cause: overloaded ?? notice('transfer.reason', {}), detail }
  const { stage, task, item } = stop.place
  return { cause: notice('transfer.stop', { stage, task, item: item ?? null, url: task === null ? null : url(task) }, overloaded === undefined ? {} : { cause: overloaded }), detail }
}

/** The stack of the deepest error under `error`, for the service log. */
export function stackOf(error: unknown): string | undefined {
  let deepest: unknown = error
  for (let depth = 0; deepest instanceof Error && deepest.cause instanceof Error && depth < 10; depth += 1) deepest = deepest.cause
  return deepest instanceof Error ? deepest.stack : undefined
}
