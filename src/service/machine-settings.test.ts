import { describe, expect, it } from 'vitest'
import type { ProjectSettings } from '../state.js'
import { afterGreenOn, cleanMachineSettings, settingsColumn, settingsFromColumn, settingsOnMachine } from './machine-settings.js'

const PROJECT = { beforeStart: ['npm install'], check: ['npm test'], afterGreen: ['npm run deploy'] } as unknown as ProjectSettings

describe("a machine's own values in a project (BTN-994)", () => {
  it('drops empty lines, empty lists and servers with nothing set', () => {
    expect(cleanMachineSettings({ beforeStart: [' npm ci ', ''], check: [], afterGreen: ['  '], servers: { files: { files: { command: ' /opt/example/files ', args: ['/srv/example', ' '] }, other: { command: '' } } } })).toEqual({
      beforeStart: ['npm ci'],
      servers: { files: { files: { command: '/opt/example/files', args: ['/srv/example'] } } },
    })
    expect(cleanMachineSettings(null)).toEqual({})
  })

  it('refuses a wrong shape', () => {
    expect(() => cleanMachineSettings({ check: 'npm test' })).toThrow(/not commands and servers/)
    expect(() => cleanMachineSettings({ servers: { files: { files: { args: 'x' } } } })).toThrow(/not commands and servers/)
  })

  it('keeps nothing as null and reads a broken column as nothing', () => {
    expect(settingsColumn({})).toBeNull()
    expect(settingsFromColumn(settingsColumn({ check: ['make check'] }))).toEqual({ check: ['make check'] })
    expect(settingsFromColumn('{')).toEqual({})
  })

  it("puts each list of the machine's own in place of the project's, the rest the project's", () => {
    expect(settingsOnMachine(PROJECT, {})).toBe(PROJECT)
    const on = settingsOnMachine(PROJECT, { check: ['make check'], servers: {} })
    expect([on.beforeStart, on.check, on.afterGreen]).toEqual([['npm install'], ['make check'], ['npm run deploy']])
    expect(afterGreenOn(PROJECT, { afterGreen: ['./deploy.sh'] })).toEqual(['./deploy.sh'])
    expect(afterGreenOn(PROJECT, {})).toEqual(['npm run deploy'])
    expect(afterGreenOn(undefined, {})).toEqual([])
  })
})
