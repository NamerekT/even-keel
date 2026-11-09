import { describe, expect, it } from 'vitest'
import { linearMinutes, linearPoints, linearScale } from './estimate.js'

describe('the Linear estimate scale', () => {
  it("takes the team's scale, extended or not, and none where the team estimates nothing", () => {
    expect(linearScale({ issueEstimationType: 'fibonacci' })).toEqual([1, 2, 3, 5, 8])
    expect(linearScale({ issueEstimationType: 'exponential', issueEstimationExtended: true })).toEqual([1, 2, 4, 8, 16, 32, 64])
    expect(linearScale({ issueEstimationType: 'notUsed' })).toBeNull()
    expect(linearScale(undefined)).toBeNull()
  })

  it('puts minutes on the point at the same step of the scale and reads it back', () => {
    const fibonacci = linearScale({ issueEstimationType: 'fibonacci' })!
    expect([5, 10, 20, 40, 80].map((minutes) => linearPoints(minutes, fibonacci))).toEqual([1, 2, 3, 5, 8])
    expect([1, 7, 15, 160].map((minutes) => linearPoints(minutes, fibonacci))).toEqual([1, 1, 3, 8])
    expect([1, 2, 3, 5, 8].map((points) => linearMinutes(points, fibonacci))).toEqual([5, 10, 20, 40, 80])
    expect(linearMinutes(4, fibonacci)).toBe(20)
    expect(linearMinutes(0, fibonacci)).toBeNull()
    expect(linearMinutes(3, null)).toBeNull()
  })
})
