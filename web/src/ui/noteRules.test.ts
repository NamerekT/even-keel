import { describe, expect, it } from 'vitest'
import { noteCounts, noteScanned, noteSpots } from './noteRules.js'

const lines = (path: string, source: string, exceptions?: Parameters<typeof noteSpots>[2]) => noteSpots(path, source, exceptions).map((spot) => spot.line)

describe('noteSpots', () => {
  it('finds an element of every note or hint class, once per element', () => {
    const source = [
      'const a = <p className="add-package__note">{text}</p>',
      'const b = <span className="settings__hint">{text}</span>',
      'const c = <Hint className="add-package__kind-hint" />',
      'const d = <p className="add-package__note add-machine__foot-note">{text}</p>',
      'const e = <p className={`task-card__run-note${warn ? " task-card__run-note--warn" : ""}`}>{text}</p>',
      'const f = <p className="add-package__field">{text}</p>',
    ].join('\n')
    expect(lines('pages/A.tsx', source)).toEqual([1, 2, 3, 4, 5])
  })
  it('counts a class held in a variable or picked by a condition', () => {
    const source = ["const cls = 'roles__note'", "const pick = warn ? 'ci__hint' : 'ci__line'"].join('\n')
    expect(lines('pages/A.ts', source)).toEqual([1, 2])
  })
  it("leaves alone a tip's own lines, a selector, a word in a text and comments", () => {
    const source = [
      'const a = <span className="panel__tip-note">{text}</span>',
      'const b = <span className="mark-tip__hint">{text}</span>',
      "const c = dialog.querySelector('.add-package__note')",
      "const d = 'Type a note or a hint here'",
      '// <p className="settings__hint">',
      'const e = <div>{/* className="settings__hint" */}</div>',
    ].join('\n')
    expect(lines('pages/A.tsx', source)).toEqual([])
  })
  it('lets through a listed exception by its file and class only', () => {
    const exceptions = [{ file: 'pages/A.tsx', className: 'danger__warn-note', why: 'a test' }]
    expect(lines('pages/A.tsx', 'const a = <p className="add-package__note danger__warn-note">x</p>', exceptions)).toEqual([])
    expect(lines('pages/A.tsx', 'const a = <p className="add-package__note">x</p>', exceptions)).toEqual([1])
    expect(lines('pages/B.tsx', 'const a = <p className="danger__warn-note">x</p>', exceptions)).toEqual([1])
  })
})

describe('noteScanned', () => {
  it('takes the page code, never stylesheets, tests, declarations, the fake data or the guard itself', () => {
    expect(['pages/A.tsx', 'pages/rows.ts'].filter(noteScanned)).toHaveLength(2)
    expect(['layout/roles.css', 'pages/A.test.tsx', 'vite-env.d.ts', 'live/fakeChats.ts', 'ui/noteRules.ts'].filter(noteScanned)).toEqual([])
  })
})

describe('noteCounts', () => {
  it('counts per file, leaves out the clean ones and sorts the keys', () => {
    const files = {
      'b.tsx': 'const a = <><p className="x__note" /><p className="y__hint" /></>',
      'a.tsx': 'const a = <p className="x__field" />',
      'c.tsx': 'const a = <p className="z-hint" />',
    }
    expect(noteCounts(files)).toEqual({ 'b.tsx': 2, 'c.tsx': 1 })
  })
})
