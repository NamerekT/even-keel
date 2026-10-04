import { describe, expect, it } from 'vitest'
import { badgedIcon, iconUrl, tabBadge } from './tabBadge.js'

describe('tabBadge', () => {
  it('shows nothing when all is well and nobody waits', () => {
    expect(tabBadge('ok', 0)).toEqual({ dot: null, title: 'Even Keel' })
  })

  it('marks sessions waiting for a reply and counts them in the title', () => {
    expect(tabBadge('ok', 2)).toEqual({ dot: 'waiting', title: '(2) Even Keel' })
  })

  it('puts an error above waiting sessions but keeps their count', () => {
    expect(tabBadge('error', 3)).toEqual({ dot: 'error', title: '(3) Even Keel' })
  })

  it('does not mark warnings', () => {
    expect(tabBadge('warn', 0)).toEqual({ dot: null, title: 'Even Keel' })
    expect(tabBadge('off', 0)).toEqual({ dot: null, title: 'Even Keel' })
  })
})

describe('badgedIcon', () => {
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32"/></svg>\n'

  it('adds the dot as the last element of the icon', () => {
    const svg = badgedIcon(icon, 'waiting')
    expect(svg).toMatch(/<rect width="32" height="32"\/>(<circle [^>]+\/>)+<\/svg>\n$/)
  })

  it('colours the dot by its kind', () => {
    const fill = (svg: string) => /<circle[^>]* fill="([^"]+)"/.exec(svg)?.[1]
    expect(fill(badgedIcon(icon, 'waiting'))).not.toBe(fill(badgedIcon(icon, 'error')))
  })

  it('turns the icon into a data URL for the icon link', () => {
    expect(iconUrl(badgedIcon(icon, 'error'))).toMatch(/^data:image\/svg\+xml,%3Csvg/)
  })
})
