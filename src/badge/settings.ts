import { fail } from '../notice/notice.js'
import { BADGE_FIELDS, isBadgeField, type BadgeField, type BadgeSettings } from './model.js'

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/**
 * A project's `badge` setting as the config holds it (BTN-915): `null` — no badge. `fields` left out is every field,
 * until the badge's dialog picks them (BTN-917); an unknown field, a bad address or slug is `config.badge`.
 */
export function badgeSettingsOf(value: unknown, where: string): BadgeSettings | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw fail('config.badge', { where })
  const { on, url, slug, fields } = value as Record<string, unknown>
  if (typeof on !== 'boolean' || typeof url !== 'string' || typeof slug !== 'string') throw fail('config.badge', { where })
  const address = url.trim()
  if (address !== '' && !isHttp(address)) throw fail('config.badge', { where })
  const name = slug.trim().toLowerCase()
  if (name !== '' && !SLUG.test(name)) throw fail('config.badge', { where })
  if (fields !== undefined && (!Array.isArray(fields) || !fields.every(isBadgeField))) throw fail('config.badge', { where })
  const picked = (fields as BadgeField[] | undefined) ?? [...BADGE_FIELDS]
  return { on, url: address, slug: name, fields: BADGE_FIELDS.filter((field) => picked.includes(field)) }
}

/** The badge pushes: it is on and says where to. */
export function badgePushes(settings: BadgeSettings | null | undefined): settings is BadgeSettings {
  return settings !== null && settings !== undefined && settings.on && settings.url !== '' && settings.slug !== ''
}

function isHttp(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
