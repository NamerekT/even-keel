import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EvenKeelState, ProjectCheck, SourceRead } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { ProviderHint } from '../layout/accountParts.js'
import { summaryOf } from './Setup.js'
import { AccountPickLabel } from './WizardMachines.js'
import { ReadLine } from './WizardRepo.js'
import { Summary } from './WizardFrame.js'

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element)

const state = (shared: object, rest: object = {}) =>
  ({
    config: { shared: { language: 'en', promptLanguage: 'en', defaultGit: true, provider: 'claude', accounts: {}, updates: { check: true }, ...shared } },
    git: { version: '2.47.0', name: 'John Doe', email: 'john.doe@example.com' },
    profiles: {
      kinds: [
        { kind: 'huly', title: 'Huly', tracker: true },
        { kind: 'github', title: 'GitHub', tracker: true },
      ],
      profiles: [],
    },
    account: { accounts: [], missing: [] },
    tally: null,
    ...rest,
  }) as unknown as EvenKeelState

const repo = (root: string | null, place?: ProjectCheck['repo']['place']): ProjectCheck['repo'] =>
  ({ root, current: 'main', suggested: null, branches: null, notice: null, ...(place && { place }) }) as ProjectCheck['repo']

const branch = createElement('span', { className: 'project-add__read-row' }, 'main')
const read = (as: SourceRead, root: string | null = null, place?: ProjectCheck['repo']['place']) =>
  html(createElement(ReadLine, { read: as, repo: repo(root, place), current: 'main', branchLine: branch }))

describe('the wizard and "Add project" glue no facts with a dot (BTN-1380)', () => {
  it("puts the prompts' language on a line of its own under the page's", () => {
    expect(summaryOf('language', state({ language: 'ru', promptLanguage: 'en' }))).toEqual({
      text: t.shared.languages.ru,
      note: t.setup.promptsIn(t.shared.languages.en),
    })
    expect(summaryOf('language', state({}))).toEqual({ text: t.shared.languages.en })
  })

  it("names git by its version and puts its name and e-mail into the tip", () => {
    expect(summaryOf('git', state({}))).toEqual({ text: 'Git 2.47.0', tip: ['John Doe', 'john.doe@example.com'] })
    expect(summaryOf('git', state({}, { git: { version: '2.47.0', name: null, email: null } }))).toEqual({ text: 'Git 2.47.0' })
  })

  it("leads the tracker step with the first profile's tracker icon and counts the rest in brackets", () => {
    const profiles = [
      { id: 'p-1', kind: 'huly', name: 'Huly · example' },
      { id: 'p-2', kind: 'github', name: 'octo-org' },
      { id: 'p-3', kind: 'github', name: 'acme' },
    ]
    const summary = summaryOf('tracker', state({}, { profiles: { kinds: state({}).profiles.kinds, profiles } }))!
    expect(summary.text).toBe('example')
    expect(summary.icon?.label).toBe('Huly')
    expect(summary.more).toBe(2)
    expect(summary.tip).toEqual(['example (Huly)', 'octo-org (GitHub)', 'acme (GitHub)'])
    const markup = html(createElement(Summary, { summary }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('(+2)')
    expect(markup).toContain('aria-label="Huly"')
  })

  it('reads an existing repository as a head with the remote and the main branch as captioned rows', () => {
    const markup = read({ as: 'existing', remote: { name: 'origin', url: 'https://git.example.com/acme/shop.git' } })
    expect(markup).not.toContain('·')
    expect(markup).toContain(`<span class="project-add__read-caption">${t.creation.reads.remote}</span>`)
    expect(markup).toContain('https://git.example.com/acme/shop.git')
    expect(markup).toContain('project-add__read-row')
  })

  it('puts a state such as "no remote" or "empty" in a tag beside the head', () => {
    expect(read({ as: 'existing', remote: null })).toContain(`<span class="tag">${t.creation.reads.noRemote}</span>`)
    expect(read({ as: 'here' }, null, { dir: null, name: 'app', state: 'empty' })).toContain(`<span class="tag">${t.creation.reads.empty}</span>`)
  })

  it('shows the folder a missing path makes as a captioned row', () => {
    const markup = read({ as: 'make' }, 'D:/Projects/app')
    expect(markup).not.toContain('·')
    expect(markup).toContain(`<span class="project-add__read-caption">${t.creation.reads.folder}</span>`)
    expect(markup).toContain('D:/Projects/app')
  })

  it("lists OpenCode's ways to sign in as tags", () => {
    const markup = html(createElement(ProviderHint, { provider: 'opencode', className: 'hint' }))
    expect(markup).not.toContain('·')
    expect(markup.match(/class="tag"/g)).toHaveLength(4)
    expect(html(createElement(ProviderHint, { provider: 'claude', className: 'hint' }))).toBe(`<span class="hint">${t.account.providerHints.claude}</span>`)
  })

  it("draws a machine's account pick as its agent's icon before the e-mail", () => {
    const markup = html(createElement(AccountPickLabel, { agent: 'claude', name: 'john.doe@example.com' }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(`aria-label="${t.account.agents.claude}"`)
    expect(markup).toContain('john.doe@example.com')
  })

  it("says a clone's speed in brackets and offers two examples in the field's placeholder", () => {
    expect(t.creation.window.received(12 * 1024 * 1024, 3 * 1024 * 1024)).not.toContain('·')
    expect(t.creation.window.received(12 * 1024 * 1024, 3 * 1024 * 1024)).toMatch(/\(.+\/s\)$/)
    expect(t.creation.targetPlaceholder('win32')).not.toContain('·')
    expect(t.profiles.builtinNote).not.toContain('·')
    expect(t.profiles.addKind('Huly')).toBe('Add Huly profile')
    expect(t.profiles.loginMcp('john.doe')).not.toContain('·')
  })
})
