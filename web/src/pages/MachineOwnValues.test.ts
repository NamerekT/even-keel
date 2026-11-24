import { describe, expect, it } from 'vitest'
import { draftOf, settingsOf } from './MachineOwnValues.js'

const SERVERS = [
  { package: 'files', server: 'files', command: 'files-mcp', args: ['/home/example'] },
  { package: 'git', server: 'git', command: 'git-mcp', args: [] },
]

describe("a machine's own values in the project (BTN-994)", () => {
  it('shows the saved values and saves them back unchanged', () => {
    const settings = { check: ['make check', 'make lint'], servers: { files: { files: { command: '/opt/example/files-mcp', args: ['/srv/example'] } } } }
    const draft = draftOf(settings, SERVERS)
    expect(draft.lists).toEqual({ beforeStart: '', check: 'make check\nmake lint', afterGreen: '' })
    expect(settingsOf(draft, SERVERS)).toEqual(settings)
  })

  it('leaves out every blank list and server, and a blank part of a server', () => {
    const draft = draftOf({}, SERVERS)
    expect(settingsOf(draft, SERVERS)).toEqual({})
    draft.lists.afterGreen = '  npm run deploy \n\n'
    draft.servers['git\u0000git'] = { command: '', args: '--root\n/srv/example\n' }
    expect(settingsOf(draft, SERVERS)).toEqual({ afterGreen: ['npm run deploy'], servers: { git: { git: { args: ['--root', '/srv/example'] } } } })
  })

  it('saves "do not run" the commands after a green main without the list it hides (BTN-1597)', () => {
    const draft = draftOf({ afterGreenOff: true }, SERVERS)
    expect(draft.afterGreenOff).toBe(true)
    draft.lists.afterGreen = './deploy.sh'
    expect(settingsOf(draft, SERVERS)).toEqual({ afterGreenOff: true })
    draft.afterGreenOff = false
    expect(settingsOf(draft, SERVERS)).toEqual({ afterGreen: ['./deploy.sh'] })
  })
})
