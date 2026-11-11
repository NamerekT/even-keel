import { expect, it } from 'vitest'
import { CheckReports, checkReportOf } from './checkreports.js'

const tree = 'a'.repeat(40)

it('keeps the latest report of each task of a project', () => {
  const reports = new CheckReports()
  reports.report('P1', 'ABC-1', { tree, commands: ['npm test'] })
  reports.report('P1', 'ABC-1', { tree: 'b'.repeat(40), commands: ['npm test'] })
  expect(reports.of('P1', 'ABC-1')).toEqual({ tree: 'b'.repeat(40), commands: ['npm test'] })
  expect(reports.of('P2', 'ABC-1')).toBeUndefined()
  expect(reports.of('P1', 'ABC-2')).toBeUndefined()
})

it('reads a report only with a commit tree and the commands as strings', () => {
  expect(checkReportOf({ tree, commands: ['npm test'] })).toEqual({ tree, commands: ['npm test'] })
  expect(checkReportOf({ tree: 'c'.repeat(64), commands: [] })).toEqual({ tree: 'c'.repeat(64), commands: [] })
  for (const body of [null, 'x', { tree }, { tree: 'HEAD', commands: [] }, { tree, commands: 'npm test' }, { tree, commands: [1] }]) expect(checkReportOf(body)).toBeNull()
})
