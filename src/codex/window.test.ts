import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { chainWindowOf, compactionLimit } from './window.js'

const ABC = '11111111-1111-4111-8111-111111111111'
const XYZ = '22222222-2222-4222-8222-222222222222'
const project = (id: string, key: string, own: Record<string, unknown> = {}) => ({ id, key, repo: `C:\\repos\\${key}`, tracker: 'huly', ...own })

describe('chainWindowOf', () => {
  it("gives a project the shared window unless it has its own, null being the model's own window", () => {
    const config = parseConfig({ codexAutoCompactWindow: 250_000, projects: [project(ABC, 'ABC'), project(XYZ, 'XYZ', { codexAutoCompactWindow: null })] })
    expect(chainWindowOf(config, ABC)).toBe(250_000)
    expect(chainWindowOf(config, XYZ)).toBeUndefined()
    expect(chainWindowOf(config, undefined)).toBe(250_000)
  })

  it("leaves the model's window when neither level sets one, and takes the project's over the shared one", () => {
    const config = parseConfig({ projects: [project(ABC, 'ABC'), project(XYZ, 'XYZ', { codexAutoCompactWindow: 400_000 })] })
    expect(chainWindowOf(config, ABC)).toBeUndefined()
    expect(chainWindowOf(config, XYZ)).toBe(400_000)
    expect(config.settings[XYZ]?.own.codexAutoCompactWindow).toBe(400_000)
  })

  it('refuses a window that is not a positive whole number', () => {
    expect(() => parseConfig({ codexAutoCompactWindow: 0, projects: [] })).toThrow()
    expect(() => parseConfig({ projects: [project(ABC, 'ABC', { codexAutoCompactWindow: 1.5 })] })).toThrow()
    expect(() => parseConfig({ openCodeAutoCompactWindow: -1, projects: [] })).toThrow()
  })

  it("reads OpenCode's window from its own key, apart from Codex's", () => {
    const config = parseConfig({ codexAutoCompactWindow: 250_000, openCodeAutoCompactWindow: 200_000, projects: [project(ABC, 'ABC'), project(XYZ, 'XYZ', { openCodeAutoCompactWindow: null })] })
    expect(chainWindowOf(config, ABC, 'openCodeAutoCompactWindow')).toBe(200_000)
    expect(chainWindowOf(config, XYZ, 'openCodeAutoCompactWindow')).toBeUndefined()
    expect(chainWindowOf(config, XYZ)).toBe(250_000)
  })
})

describe('compactionLimit', () => {
  it('compacts 32k before the window, as Claude does', () => {
    expect(compactionLimit(250_000)).toBe(218_000)
  })
})
