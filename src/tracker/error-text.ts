/**
 * The message of an error with its cause: Node's `fetch` says only "fetch failed" and keeps the reason (DNS, refused) in
 * `cause`. An error without a message, as Huly storage's `NotFoundError` of a 404, is named by its class (BTN-1454) with
 * its HTTP status or code where it has one: the text is never blank (BTN-1455). Free of `node:*`: the page's fakes reach
 * it through `transfer-stop.ts`.
 */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error) === '' ? 'an empty error' : String(error)
  const { cause } = error
  return cause instanceof Error ? `${saidOf(error)}: ${saidOf(cause)}` : saidOf(error)
}

function saidOf(error: Error): string {
  if (error.message.trim() !== '') return error.message
  const { status, code } = error as { status?: unknown; code?: unknown }
  const platform = typeof status === 'object' && status !== null ? (status as { code?: unknown }).code : undefined
  const extra =
    typeof status === 'number' ? `HTTP ${status}` : typeof platform === 'string' ? platform : typeof code === 'string' || typeof code === 'number' ? `code ${code}` : ''
  const name = error.name.trim() === '' ? 'Error' : error.name
  return extra === '' ? name : `${name} (${extra})`
}
