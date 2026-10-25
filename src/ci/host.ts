/** A server's address with a scheme (`https://` when absent), without a trailing slash. */
export function forgejoBase(url: string): string {
  const trimmed = url.trim()
  return (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).replace(/\/+$/, '')
}

/** The lowercase host of a profile or remote address; `null` when it cannot be read. */
export function hostOf(url: string): string | null {
  try {
    return new URL(forgejoBase(url)).hostname.toLowerCase() || null
  } catch {
    return null
  }
}
