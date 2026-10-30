import { describe, expect, it } from 'vitest'
import { allTrackersOn, switched, TRACKER_PROTECTION } from './protectionDraft.js'

describe('the switch of all trackers', () => {
  it('is on exactly when no tracker is off', () => {
    expect(allTrackersOn([])).toBe(true)
    expect(allTrackersOn(['forcePush'])).toBe(true)
    expect(allTrackersOn(['deleteGitlab'])).toBe(false)
  })

  it('turns every tracker on or off, and leaves the other groups', () => {
    expect(switched(['forcePush', 'deleteJira'], TRACKER_PROTECTION, true)).toEqual(['forcePush'])
    expect(switched(['forcePush', 'deleteJira'], TRACKER_PROTECTION, false)).toEqual(['forcePush', 'deleteJira', 'deleteHuly', 'deleteGithub', 'deleteGitlab', 'deleteLinear'])
  })

  it('lights up again when the last tracker is turned back on', () => {
    expect(allTrackersOn(switched(['deleteHuly'], ['deleteHuly'], true))).toBe(true)
    expect(allTrackersOn(switched([], ['deleteHuly'], false))).toBe(false)
  })
})
