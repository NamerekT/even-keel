/** A team's estimate settings as Linear gives them: `issueEstimationType` and whether the scale is extended. */
export interface LinearEstimation {
  issueEstimationType: string
  issueEstimationExtended?: boolean
}

/** The team fields of `LinearEstimation`, for a query. */
export const ESTIMATION_FIELDS = 'issueEstimationType issueEstimationExtended'

// The points of each scale, the extended steps last; a T-shirt size is kept as its points too.
const SCALES: Readonly<Record<string, readonly number[]>> = {
  exponential: [1, 2, 4, 8, 16, 32, 64],
  fibonacci: [1, 2, 3, 5, 8, 13, 21],
  linear: [1, 2, 3, 4, 5, 6, 7],
  tShirt: [1, 2, 3, 5, 8, 13, 21],
}

const SHORTEST_MIN = 5

/** The team's points, smallest first; `null` — the team estimates nothing (`notUsed`) or has a scale not known here. */
export function linearScale(team: LinearEstimation | null | undefined): readonly number[] | null {
  const scale = team === null || team === undefined ? undefined : SCALES[team.issueEstimationType]
  if (scale === undefined) return null
  return team!.issueEstimationExtended === true ? scale : scale.slice(0, 5)
}

/**
 * Linear's estimate is the team's points, not time (BTN-911): minutes go by the step of the doubling scale the agent
 * estimates on (5, 10, 20, 40, 80…) to the point at the same place of the team's scale, the last one past its end.
 */
export function linearPoints(minutes: number, scale: readonly number[]): number {
  const step = Math.round(Math.log2(Math.max(minutes, 1) / SHORTEST_MIN))
  return scale[Math.min(Math.max(step, 0), scale.length - 1)]!
}

/** The points back as the minutes of their step; `null` — no estimate. A point off the scale takes the step below it. */
export function linearMinutes(points: number | null | undefined, scale: readonly number[] | null): number | null {
  if (points === null || points === undefined || points <= 0 || scale === null) return null
  const below = scale.filter((each) => each <= points).length
  return SHORTEST_MIN * 2 ** Math.max(below - 1, 0)
}
