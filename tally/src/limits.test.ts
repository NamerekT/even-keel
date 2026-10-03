import { describe, expect, it } from 'vitest'
import { snapshotsOfFile, snapshotsOfState } from './limits.js'

describe('snapshotsOfState', () => {
  it('takes both windows of every account', () => {
    const state = {
      account: {
        accounts: [
          {
            key: 'global',
            limits: {
              fiveHour: { usedPercentage: 75, resetsAt: '2026-10-03T16:40:00.000Z' },
              sevenDay: null,
              updatedAt: '2026-10-03T15:41:13.339Z',
              source: 'statusline',
            },
          },
          { key: 'john.doe', limits: null },
        ],
      },
    }
    expect(snapshotsOfState(state)).toEqual([
      {
        account: 'global',
        window: '5h',
        observedAt: '2026-10-03T15:41:13.339Z',
        usedPercentage: 75,
        resetsAt: '2026-10-03T16:40:00.000Z',
        source: 'statusline',
      },
    ])
  })

  it('returns nothing for an unexpected shape', () => {
    expect(snapshotsOfState({})).toEqual([])
    expect(snapshotsOfState(null)).toEqual([])
  })
})

describe('snapshotsOfFile', () => {
  it('reads the statusline file and its account', () => {
    const raw = {
      receivedAt: '2026-10-03T15:41:15.311Z',
      configDir: 'C:\\Users\\john\\.claude-accounts\\john.doe',
      rate_limits: { five_hour: { used_percentage: 76, resets_at: 1791045600 }, seven_day: { used_percentage: 6, resets_at: 1791637200 } },
    }
    const owner = (dir: string | null) => (dir === null ? 'global' : 'john.doe')
    expect(snapshotsOfFile(raw, owner).map((row) => [row.account, row.window, row.usedPercentage, row.source])).toEqual([
      ['john.doe', '5h', 76, 'statusline'],
      ['john.doe', '7d', 6, 'statusline'],
    ])
  })

  it('skips a file whose folder is no known account', () => {
    const raw = { receivedAt: '2026-10-03T15:41:15.311Z', configDir: 'X:\\gone', rate_limits: { five_hour: { used_percentage: 1, resets_at: 1 } } }
    expect(snapshotsOfFile(raw, () => undefined)).toEqual([])
  })
})
