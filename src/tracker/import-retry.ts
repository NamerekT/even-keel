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
  const retried = async <T>(what: string, read: () => Promise<T>): Promise<T> => {
    for (let tried = 0; ; tried += 1) {
      try {
        return await read()
      } catch (error) {
        if (!transient(error)) throw error
        if (tried >= pauses.length) throw new SourceBusy(tried + 1, error)
        options.say(`import: the tracker refused ${what}, asking again in ${Math.round(pauses[tried]! / 1000)} s: ${errorText(error)}`)
        await new Promise((resolve) => setTimeout(resolve, pauses[tried]))
      }
    }
  }
  const fileOf = (file: ImportFile): ImportFile => ({ ...file, read: () => retried(`the file ${file.name}`, () => file.read()) })
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
