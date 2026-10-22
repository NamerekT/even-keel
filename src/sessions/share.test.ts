import { describe, expect, it } from 'vitest'
import { shareOf } from './share.js'

describe('shareOf', () => {
  it('keeps the caption, the files as named and the folder of the call', () => {
    expect(shareOf({ files: ['D:/repo/.temp/audit.md', 'notes/plan.md'], caption: ' Audit ' }, 'D:\\repo')).toEqual({
      caption: 'Audit',
      files: ['D:/repo/.temp/audit.md', 'notes/plan.md'],
      folder: 'D:\\repo',
    })
  })

  it('takes a call without a caption or with odd files', () => {
    expect(shareOf({ files: ['/srv/repo/a.png', 7, ''] }, '/srv/repo')).toEqual({ caption: '', files: ['/srv/repo/a.png'], folder: '/srv/repo' })
    expect(shareOf({}, '')).toEqual({ caption: '', files: [], folder: '' })
  })
})
