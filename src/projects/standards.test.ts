import { describe, expect, it } from 'vitest'
import { standardsOf } from './standards.js'

describe('standardsOf', () => {
  it('normalizes the document path and the masks and drops the empty ones', () => {
    expect(standardsOf([{ doc: ' docs\\design.md ', files: [' web/**/*.tsx', '', 'web/**/*.tsx'], except: ['**\\*.test.*'], shots: true }])).toEqual([
      { doc: 'docs/design.md', files: ['web/**/*.tsx'], except: ['**/*.test.*'], shots: true },
    ])
  })

  it('takes a standard without exceptions or shots as one with none', () => {
    expect(standardsOf([{ doc: 'STYLE.md', files: ['src/**/*.ts'] }])).toEqual([{ doc: 'STYLE.md', files: ['src/**/*.ts'], except: [], shots: false }])
    expect(standardsOf([])).toEqual([])
  })

  it.each([
    ['not a list', { doc: 'a.md', files: ['*.ts'] }],
    ['a document outside the repository', [{ doc: '../a.md', files: ['*.ts'] }]],
    ['no masks', [{ doc: 'a.md', files: [' '] }]],
    ['a mask that is not text', [{ doc: 'a.md', files: [1] }]],
    ['shots that are not a switch', [{ doc: 'a.md', files: ['*.ts'], shots: 'yes' }]],
    ['one document twice', [{ doc: 'a.md', files: ['*.ts'] }, { doc: './a.md', files: ['*.css'] }]],
  ])('refuses %s', (_, value) => {
    expect(standardsOf(value)).toBeNull()
  })
})
