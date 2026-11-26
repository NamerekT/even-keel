import { describe, expect, it } from 'vitest'
import { rowCounts, rowScanned, rowSpots } from './rowRules.js'

const lines = (source: string) => rowSpots('pages/A.tsx', source).map((spot) => spot.line)

describe('rowSpots', () => {
  it('finds a Row whose control stands at the right of its name', () => {
    const source = [
      'const a = <Row className="x" label="A" control={<input />} />',
      'const b = <Row className="x" label="B" control={<Select value={v} />} error={e} />',
      'const c = (',
      '  <Row',
      '    className="x"',
      '    label="C"',
      '    control={number(key)}',
      '  />',
      ')',
      'const d = <Row {...props} />',
    ].join('\n')
    expect(lines(source)).toEqual([1, 2, 4, 10])
  })
  it('lets a switch keep its name line', () => {
    const source = [
      'const a = <Row className="x" label="A" control={<Switch id={id} checked={on} onChange={set} />} />',
      'const b = <Row className="x" label="B" control={(<Switch checked={on} onChange={set} />)}>{children}</Row>',
    ].join('\n')
    expect(lines(source)).toEqual([])
  })
  it('leaves alone a Field, a Row of another kind and a word in a text', () => {
    const source = [
      'const a = <Field className="x" label="A" control={<input />} />',
      'const b = <Row task={task} onCard={onCard} />',
      "const c = 'a <Row control={x} /> in a string'",
      '// <Row className="x" label="A" control={<input />} />',
    ].join('\n')
    expect(lines(source)).toEqual([])
  })
})

describe('rowCounts', () => {
  it('counts per file and leaves clean files out', () => {
    expect(rowCounts({ 'pages/B.tsx': '<Row label="a" control={<input />} />', 'pages/A.tsx': '<Field label="a" control={<input />} />' })).toEqual({ 'pages/B.tsx': 1 })
  })
})

describe('rowScanned', () => {
  it('reads page code, not tests, fakes or the parts that define Row', () => {
    expect(['pages/A.tsx', 'pages/A.test.tsx', 'pages/settingsParts.tsx', 'live/fakeState.tsx', 'pages/a.ts'].filter(rowScanned)).toEqual(['pages/A.tsx'])
  })
})
