/** Where GitHub keeps the files dropped into a comment. */
export const UPLOADS = /^https:\/\/(github\.com\/user-attachments\/|private-user-images\.githubusercontent\.com\/)/

const SIGNED_HOST = 'private-user-images.githubusercontent.com'
const ASSET_PATH = /^\/user-attachments\/assets\/([0-9a-f-]+)$/i
const SIGNED_PATH = /^\/\d+\/\d+-([0-9a-f-]+)(?:\.[a-z0-9]+)?$/i

/**
 * The id of an uploaded image in its link: `github.com/user-attachments/assets/<id>`, or a signed
 * `private-user-images…/<user>/<n>-<id>.<ext>` link. `null` for anything else, a `user-attachments/files/` link too.
 */
export function uploadId(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  const match = url.host === 'github.com' ? ASSET_PATH.exec(url.pathname) : url.host === SIGNED_HOST ? SIGNED_PATH.exec(url.pathname) : null
  return match?.[1]?.toLowerCase() ?? null
}

/**
 * The signed `private-user-images` link of the upload `id` in a comment's `body_html` (BTN-652): it downloads with
 * no token, which a fine-grained token cannot do with the plain link of a private repository. It lives minutes.
 */
export function signedLink(html: string, id: string): string | null {
  for (const match of html.matchAll(/(?:src|href)="(https:\/\/private-user-images\.githubusercontent\.com\/[^"]+)"/g)) {
    const link = match[1]!.replaceAll('&amp;', '&')
    if (uploadId(link) === id) return link
  }
  return null
}

/** The `rel="next"` page of a REST answer's `Link` header. */
export function nextPage(link: string | null): string | null {
  return link?.split(',').map((part) => /<([^>]+)>;\s*rel="next"/.exec(part)?.[1]).find((url) => url !== undefined) ?? null
}
