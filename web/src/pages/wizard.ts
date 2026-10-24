/** Where a step of a wizard stands against the one open: its dot is filled, a ring, or empty. */
export type StepMark = 'done' | 'current' | 'future'

/** The steps before the current one are done, those after it are ahead. */
export function stepMarks<T>(steps: readonly T[], current: T): StepMark[] {
  const at = steps.indexOf(current)
  return steps.map((_, index) => (index < at ? 'done' : index === at ? 'current' : 'future'))
}

/** How much of the line between the first dot and the last is filled: up to the current step. */
export function filledShare<T>(steps: readonly T[], current: T): number {
  return steps.length < 2 ? 0 : Math.max(0, steps.indexOf(current)) / (steps.length - 1)
}

/** A step whose fields are all on one page, as its check left it: not filled in yet, passed, or refused. */
export type StepCheck = 'empty' | 'passed' | 'failed'

/** A dot of a step: where it stands on the line, or what its check said (green or red). */
export type DotMark = StepMark | 'passed' | 'failed'

/** A checked step's dot: never `done`, a check says passed instead. */
export type CheckMark = Exclude<DotMark, 'done'>

/** The checked steps' dots: the first one not filled in is where the typing stopped, a ring; the empty ones after it stay empty. */
export function checkMarks(checks: readonly StepCheck[]): CheckMark[] {
  const at = checks.indexOf('empty')
  return checks.map((check, index) => (check !== 'empty' ? check : index === at ? 'current' : 'future'))
}

/** What a done step holds, in a few words: the first item and how many more. */
export function listSummary(items: readonly string[]): string | null {
  if (items.length === 0) return null
  return items.length === 1 ? items[0]! : `${items[0]} +${items.length - 1}`
}
