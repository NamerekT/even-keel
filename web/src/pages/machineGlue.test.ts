import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EvenKeelState, MachinePage } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { checkText, JoinedAbout, projectGroup } from '../layout/MachineJoined.js'
import { machineOption } from './ConnectMachine.js'
import { SessionsCard } from './MachinePage.js'
import { ServerName } from './MachineOwnValues.js'
import { AfterGreen } from './ProjectMachinesTab.js'

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element)

describe('the machine screens glue no facts with a dot (BTN-1381)', () => {
  it("names git by its version alone and puts its name and e-mail into the row's tip", () => {
    expect(checkText({ id: 'git', ok: true, version: '2.47.0', user: true })).toEqual({ text: 'git 2.47.0', tip: t.machines.gitUser })
    expect(checkText({ id: 'git', ok: false, version: '2.47.0', user: false })).toEqual({ text: 'git 2.47.0', tip: t.machines.gitNoUser, effect: t.machines.gitNoUserEffect })
  })

  it('shows the joined machine\'s system and Even Keel as captioned cells', () => {
    const markup = html(createElement(JoinedAbout, { os: 'Linux 6.8.0', version: '0.4.0' }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(t.machines.aboutOs)
    expect(markup).toContain('Linux 6.8.0')
    expect(markup).toContain('0.4.0')
  })

  it("heads a project's steps in the connecting window by its name with the key in brackets", () => {
    const state = { projectLabels: { 'p-1': 'ABC', 'p-2': 'XYZ' }, config: { projects: { 'p-1': { name: 'Storefront' }, 'p-2': {} } } } as unknown as EvenKeelState
    expect(projectGroup(state, 'p-1')).toBe('Storefront (ABC)')
    expect(projectGroup(state, 'p-2')).toBe('XYZ')
  })

  it("draws a session's agent and model as the model's tag", () => {
    const page = { sessions: [{ sessionId: 's-1', task: 'ABC-7', agent: 'claude', model: 'claude-opus-5-5', lamp: 'working', cwd: '/srv/example' }] } as unknown as MachinePage
    const markup = html(createElement(SessionsCard, { page }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('run-label')
    expect(markup).toContain('Claude')
  })

  it('lights a session whose merge is being landed as at work, not as a question (BTN-1779)', () => {
    const page = { sessions: [{ sessionId: 's-1', task: 'ABC-7', agent: 'claude', model: null, lamp: 'waiting', cwd: '/srv/example' }] } as unknown as MachinePage
    expect(html(createElement(SessionsCard, { page }))).toContain('lamp--waiting')
    const markup = html(createElement(SessionsCard, { page, landing: new Set(['s-1']) }))
    expect(markup).toContain('lamp--working')
    expect(markup).toContain(t.session.landing)
  })

  it("shows a machine's own commands after green as a command block each, never a tag (BTN-1553)", () => {
    const markup = html(createElement(AfterGreen, { commands: ['npm run build', 'npm run deploy'], own: true }))
    expect(markup).not.toContain('·')
    expect(markup).not.toContain('class="tag"')
    expect(markup.match(/class="ui-command[ "]/g)).toHaveLength(2)
    expect(markup).toContain('npm run deploy')
  })

  it("says the project's commands run without repeating them on every machine (BTN-1553)", () => {
    const markup = html(createElement(AfterGreen, { commands: ['npm run build'], own: false })).replaceAll('&#x27;', "'")
    expect(markup).toContain(t.pool.afterGreenProjects)
    expect(markup).not.toContain('npm run build')
    expect(markup).not.toContain('ui-command')
  })

  it('says in words that a machine runs no commands after green (BTN-1597)', () => {
    const markup = html(createElement(AfterGreen, { commands: [], own: true, off: true }))
    expect(markup).not.toContain('class="tag"')
    expect(markup).toContain(t.pool.afterGreenOff)
  })

  it('marks a machine off the link by a lamp in the pick, not by a word after a dot', () => {
    const option = machineOption({ id: 'm-1', name: 'Example laptop', online: false })
    expect(option.label).toBe('Example laptop')
    expect(html(createElement('span', null, option.aside))).toContain('lamp')
    expect(machineOption({ id: 'm-2', name: 'Example desktop', online: true }).aside).toBeUndefined()
  })

  it("names a package's server by the package and the server in a tag", () => {
    expect(html(createElement(ServerName, { pkg: 'files', server: 'files' }))).not.toContain('tag')
    const markup = html(createElement(ServerName, { pkg: 'package', server: 'server' }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('<span class="tag">server</span>')
  })
})
