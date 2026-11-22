import { errorText } from './error-text.js'
import type { ImportFile, ImportSource } from './import.js'

/**
 * The pauses before each new ask of a source's transient refusal (BTN-1460): three more tries over about a minute. An
 * overloaded Huly answered again within a couple of minutes.
 */
export const RETRY_PAUSES_MS: readonly number[] = [5_000, 15_000, 40_000]

/** A source that refused every try with what its adapter calls transient: the import's stop says it was overloaded. */
export class SourceBusy extends Error {
  override readonly name = 'SourceBusy'

  constructor(
    readonly tries: number,
    cause: unknown,
  ) {
    super(`the tracker refused ${tries} tries in a row`, { cause })
  }
}

/** The `SourceBusy` under `error`, through its causes; `null` — none. */
export function sourceBusy(error: unknown): SourceBusy | null {
  for (let each = error, depth = 0; each instanceof Error && depth < 10; each = each.cause, depth += 1) {
    if (each instanceof SourceBusy) return each
  }
  return null
}

export interface RetryOptions {
  pauses?: readonly number[]
  /** Each new ask, for the service log. */
  say: (line: string) => void
  /** Aborted — no new try goes, a pause ends at once with the signal's reason (BTN-1453). */
  signal?: AbortSignal
}

/**
 * The source with each read asked again after a refusal its adapter calls transient (`ImportSource.transient`), a pause
 * of `pauses` before each new try; the last one refused is a `SourceBusy`. The plan's read, the run, its check and the
 * switch's pass read through it alike.
 */
export function retryingSource(source: ImportSource, options: RetryOptions): ImportSource {
  const transient = source.transient?.bind(source)
  if (transient === undefined) return source
  const pauses = options.pauses ?? RETRY_PAUSES_MS
  const { signal } = options
  const retried = async <T>(what: string, read: () => Promise<T>): Promise<T> => {
    for (let tried = 0; ; tried += 1) {
      signal?.throwIfAborted()
      try {
        return await read()
      } catch (error) {
        signal?.throwIfAborted()
        if (!transient(error)) throw error
        if (tried >= pauses.length) throw new SourceBusy(tried + 1, error)
        options.say(`import: the tracker refused ${what}, asking again in ${Math.round(pauses[tried]! / 1000)} s: ${errorText(error)}`)
        await pause(pauses[tried]!, signal)
      }
    }
  }
  // The fields are read through: an adapter may learn a file's name, type and size on its read.
  const fileOf = (file: ImportFile): ImportFile => ({
    key: file.key,
    get name() { return file.name },
    get type() { return file.type },
    get size() { return file.size },
    read: () => retried(`the file ${file.name}`, () => file.read()),
  })
  const { changes } = source
  return {
    ...source,
    tasks: () => retried('the tasks', () => source.tasks()),
    milestones: () => retried('the milestones', () => source.milestones()),
    comments: (ref) => retried(`the comments of ${ref}`, () => source.comments(ref)),
    files: async (ref) => (await retried(`the files of ${ref}`, () => source.files(ref))).map(fileOf),
    ...(changes === undefined ? {} : { changes: (ref: string) => retried(`the change log of ${ref}`, () => changes.call(source, ref)) }),
  }
}

/**
 * The source asked nothing more once `signal` is aborted (BTN-1453): each read then fails with the signal's reason. A
 * read already sent is answered; the plan reads no file's bytes, so they are passed as they are.
 */
export function abortableSource(source: ImportSource, signal: AbortSignal): ImportSource {
  const guarded = <A extends unknown[], T>(read: (...args: A) => Promise<T>) => (...args: A): Promise<T> => {
    try {
      signal.throwIfAborted()
    } catch (reason) {
      return Promise.reject(reason)
    }
    return read.apply(source, args)
  }
  const { changes } = source
  return {
    ...source,
    tasks: guarded(source.tasks),
    milestones: guarded(source.milestones),
    comments: guarded(source.comments),
    files: guarded(source.files),
    ...(changes === undefined ? {} : { changes: guarded(changes) }),
  }
}

/** `ms` of waiting, ended at once with the reason of an aborted `signal`. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, ms)
    signal?.addEventListener('abort', stop, { once: true })
  })
}
