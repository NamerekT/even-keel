import { describe, expect, it } from 'vitest'
import { BADGE_FIELDS } from '../../../src/badge/model.js'
import { badgeDraft, badgeMarkdown, BADGE_GROUPS, badgePngName, defaultSlug, groupOn, releasesLink, withGroup } from './badgeParts.js'

describe('badgePngName', () => {
  it('names the snapshot by the slug, the local minute and the theme, padded', () => {
    expect(badgePngName('abc', 'dark', new Date(2026, 10, 3, 4, 5))).toBe('abc-badge-2026-11-03-0405-dark.png')
    expect(badgePngName('my-app', 'light', new Date(2026, 0, 31, 23, 59))).toBe('my-app-badge-2026-01-31-2359-light.png')
  })
})

describe('badge groups', () => {
  it('cover every field once', () => {
    const fields = BADGE_GROUPS.flatMap((group) => group.fields)
    expect([...fields].sort()).toEqual([...BADGE_FIELDS].sort())
  })

  it('a group is on only with all its fields, and switching keeps the fields in their order', () => {
    const tasks = BADGE_GROUPS.find((group) => group.id === 'tasks')!
    expect(groupOn(['agent', 'model', 'time', 'action'], tasks)).toBe(true)
    expect(groupOn(['agent', 'model'], tasks)).toBe(false)
    expect(withGroup(['chain', 'agent'], tasks, true)).toEqual(['agent', 'model', 'time', 'action', 'chain'])
    expect(withGroup([...BADGE_FIELDS], tasks, false)).toEqual(['title', 'context', 'chain', 'milestone', 'sessions', 'medianCost', 'medianMinutes'])
  })
})

describe('defaultSlug', () => {
  it('is the project key in lower case, other characters turned into dashes', () => {
    expect(defaultSlug('BTN')).toBe('btn')
    expect(defaultSlug('MY_APP 2')).toBe('my-app-2')
    expect(defaultSlug('__')).toBe('project')
  })
})

describe('badgeDraft', () => {
  it('starts a project without a badge off, every field picked, the name from the key', () => {
    expect(badgeDraft(null, 'ABC')).toEqual({ on: false, url: '', slug: 'abc', fields: [...BADGE_FIELDS] })
    const saved = { on: true, url: 'https://b.example.com', slug: 'x', fields: [] }
    expect(badgeDraft(saved, 'ABC')).toBe(saved)
  })
})

describe('releasesLink', () => {
  it('prefers GitHub, then GitLab with its own path, then any other forge, never a local remote', () => {
    const forgejo = { id: 'git.example.com/team/app', path: 'team/app' }
    const github = { id: 'github.com/team/app', path: 'team/app' }
    const gitlab = { id: 'gitlab.com/team/app', path: 'team/app' }
    const local = { id: 'd:/repos/app', path: 'app' }
    expect(releasesLink([forgejo, github])).toBe('https://github.com/team/app/releases')
    expect(releasesLink([forgejo, gitlab])).toBe('https://gitlab.com/team/app/-/releases')
    expect(releasesLink([local, forgejo])).toBe('https://git.example.com/team/app/releases')
    expect(releasesLink([local, { id: '/srv/git/app', path: 'app' }])).toBeNull()
    expect(releasesLink([])).toBeNull()
  })
})

describe('badgeMarkdown', () => {
  it('is a picture for each theme inside a link to the releases', () => {
    expect(badgeMarkdown({ url: 'https://badge.example.com/', slug: 'abc', name: 'Example', releases: 'https://github.com/team/app/releases' })).toBe(
      '<a href="https://github.com/team/app/releases"><picture><source media="(prefers-color-scheme: light)" srcset="https://badge.example.com/abc.svg?theme=light"><img alt="Example: what the chain is building now" src="https://badge.example.com/abc.svg?theme=dark"></picture></a>',
    )
  })

  it('leaves out the link without one and escapes the name', () => {
    expect(badgeMarkdown({ url: 'https://badge.example.com', slug: 'abc', name: 'A "quoted" <app> & co', releases: '' })).toBe(
      '<picture><source media="(prefers-color-scheme: light)" srcset="https://badge.example.com/abc.svg?theme=light"><img alt="A &quot;quoted&quot; &lt;app&gt; &amp; co: what the chain is building now" src="https://badge.example.com/abc.svg?theme=dark"></picture>',
    )
  })
})
