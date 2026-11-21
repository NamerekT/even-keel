/**
 * A tracker refused a call for its rate limit (BTN-1190): not a failure of the write, a wait. `until` is when the
 * tracker said it takes calls again; `null` — it named no time.
 */
export class TrackerRateLimited extends Error {
  override readonly name = 'TrackerRateLimited'

  constructor(
    message: string,
    readonly until: Date | null,
  ) {
    super(message)
  }
}

interface Answer {
  status: number
  headers: Pick<Headers, 'get'>
}

/** GitHub's own words for a refusal of its limits, primary and secondary, which come as HTTP 403. */
const LIMIT_TEXT = /rate limit|abuse detection/i

/**
 * The limit an answer of the tracker refused a call for: HTTP 429, or 403 with `retry-after`, with nothing left in the
 * window (`x-ratelimit-remaining: 0`) or GitHub's text of its limits; `null` — another refusal or none.
 */
export function limitOfResponse(tracker: string, response: Answer, message: string, now = Date.now()): TrackerRateLimited | null {
  const { status, headers } = response
  const limited =
    status === 429 || (status === 403 && (headers.get('retry-after') !== null || headers.get('x-ratelimit-remaining') === '0' || LIMIT_TEXT.test(message)))
  if (!limited) return null
  const until = untilOf(headers, now)
  return new TrackerRateLimited(`${tracker}: rate limited (HTTP ${status})${message ? `: ${message}` : ''}${until === null ? '' : ` until ${until.toISOString()}`}`, until)
}

/**
 * When the tracker takes calls again by the answer's headers: `retry-after` (seconds or an HTTP date), else the reset of
 * the window — `x-ratelimit-reset` (GitHub, Forgejo: epoch seconds; Jira: an ISO time), `ratelimit-reset` (GitLab) or
 * `x-ratelimit-requests-reset` (Linear: epoch milliseconds); `null` — none of them.
 */
export function untilOf(headers: Pick<Headers, 'get'>, now = Date.now()): Date | null {
  const after = headers.get('retry-after')?.trim()
  if (after) {
    if (/^\d+$/.test(after)) return new Date(now + Number(after) * 1000)
    const date = Date.parse(after)
    if (!Number.isNaN(date)) return new Date(date)
  }
  for (const name of ['x-ratelimit-reset', 'ratelimit-reset', 'x-ratelimit-requests-reset']) {
    const value = headers.get(name)?.trim()
    if (!value) continue
    if (/^\d+$/.test(value)) {
      const number = Number(value)
      // Epoch seconds now are ten digits, milliseconds thirteen.
      return new Date(number > 1e11 ? number : number * 1000)
    }
    const date = Date.parse(value)
    if (!Number.isNaN(date)) return new Date(date)
  }
  return null
}

/** The rate limit an error is or was caused by; `null` — another error. */
export function rateLimitOf(error: unknown): TrackerRateLimited | null {
  for (let each = error, depth = 0; each instanceof Error && depth < 10; each = each.cause, depth += 1) {
    if (each instanceof TrackerRateLimited) return each
  }
  return null
}
