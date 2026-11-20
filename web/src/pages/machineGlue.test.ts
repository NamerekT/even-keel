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

  it('lists the commands after green as tags', () => {
    const markup = html(createElement(AfterGreen, { commands: ['Tests', 'macOS'], own: false }))
    expect(markup).not.toContain('·')
    expect(markup.match(/class="tag"/g)).toHaveLength(2)
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
