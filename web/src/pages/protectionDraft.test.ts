import { describe, expect, it } from 'vitest'
import { allTrackersOn, protectionText, sameProtection, switched, TRACKER_PROTECTION } from './protectionDraft.js'

describe('two protections compared', () => {
  const base = { disabled: ['deleteHuly', 'forcePush'], claude: ['Bash(rm*)'], codex: [['rm']], copilot: [], opencode: [] }

  it('are the same whatever order the groups were switched off in, and with stray spaces in the lines', () => {
    const reordered = JSON.stringify({ ...JSON.parse(protectionText(base)), disabled: ['forcePush', 'deleteHuly'], claude: ' Bash(rm*)\n' })
    expect(sameProtection(protectionText(base), reordered)).toBe(true)
  })

  it('differ by a group or a line, and an inherited one from any own', () => {
    expect(sameProtection(protectionText(base), protectionText({ ...base, disabled: ['forcePush'] }))).toBe(false)
    expect(sameProtection(protectionText(base), protectionText({ ...base, claude: [] }))).toBe(false)
    expect(sameProtection('', protectionText(base))).toBe(false)
    expect(sameProtection('', '')).toBe(true)
  })
})

describe('the switch of all trackers', () => {
  it('is on exactly when no tracker is off', () => {
    expect(allTrackersOn([])).toBe(true)
    expect(allTrackersOn(['forcePush'])).toBe(true)
    expect(allTrackersOn(['deleteGitlab'])).toBe(false)
  })

  it('turns every tracker on or off, and leaves the other groups', () => {
    expect(switched(['forcePush', 'deleteJira'], TRACKER_PROTECTION, true)).toEqual(['forcePush'])
    expect(switched(['forcePush', 'deleteJira'], TRACKER_PROTECTION, false)).toEqual(['forcePush', 'deleteJira', 'deleteHuly', 'deleteGithub', 'deleteGitlab', 'deleteLinear', 'deleteForgejo'])
  })

  it('lights up again when the last tracker is turned back on', () => {
    expect(allTrackersOn(switched(['deleteHuly'], ['deleteHuly'], true))).toBe(true)
    expect(allTrackersOn(switched([], ['deleteHuly'], false))).toBe(false)
  })
})
