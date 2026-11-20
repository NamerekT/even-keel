/**
 * The guard of "Facts are never glued" (docs/design.md, BTN-1373): every `·` the page can show between two facts — in a
 * string, a template or JSX text of `web/src`, or drawn by a stylesheet's `content` — as a spot with its line.
 * Comments and regular expressions are not read. Used by `web/src/design.test.ts` and `scripts/design-baseline.ts`.
 */
import ts from 'typescript'

export interface GlueSpot {
  line: number
  text: string
}

const DOT = '·'

/** Dots that stand alone as a mark, not between facts: the file under `web/src` and the literal's whole text. */
export const GLUE_EXCEPTIONS: { file: string; text: string; why: string }[] = [
  { file: 'layout/Basement.tsx', text: '  ·  ', why: "the basement's caution tape repeats its word as an ornament" },
  { file: 'pages/AskPanel.tsx', text: '·', why: 'the mark of an option not picked, beside the ✓ of a picked one' },
  { file: 'pages/CardJournal.tsx', text: '·', why: 'the avatar of a comment whose author has no name' },
]

/** Whether a path under `web/src` is page code or a stylesheet the guard reads; the guard's own dots are its rules. */
export function glueScanned(path: string): boolean {
  if (!/\.(tsx?|css)$/.test(path) || /\.test\.tsx?$/.test(path) || path.endsWith('.d.ts') || path === 'ui/glueRules.ts') return false
  return !/(^|\/)live\/fake[^/]*$/.test(path)
}

const literalKinds = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

const dots = (text: string): number => text.split(DOT).length - 1

function codeSpots(path: string, source: string): GlueSpot[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const excepted = new Set(GLUE_EXCEPTIONS.filter((each) => each.file === path).map((each) => each.text))
  const spots: GlueSpot[] = []
  const visit = (node: ts.Node): void => {
    if (literalKinds.has(node.kind)) {
      const text = (node as ts.LiteralLikeNode).text
      if (!excepted.has(text)) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
        for (let index = dots(text); index > 0; index--) spots.push({ line, text: text.trim() })
      }
    }
    node.forEachChild(visit)
  }
  visit(file)
  return spots
}

function sheetSpots(css: string): GlueSpot[] {
  const blank = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  const spots: GlueSpot[] = []
  for (const found of blank.matchAll(/\bcontent\s*:\s*([^;}]*)/g)) {
    const line = blank.slice(0, found.index).split('\n').length
    const count = dots(found[1]!) + [...found[1]!.matchAll(/\\0{0,4}b7(?![0-9a-f])/gi)].length
    for (let index = count; index > 0; index--) spots.push({ line, text: found[0].trim() })
  }
  return spots
}

/** The glued dots of one file under `web/src`, by its path's extension. */
export function glueSpots(path: string, source: string): GlueSpot[] {
  return path.endsWith('.css') ? sheetSpots(source) : codeSpots(path, source)
}

/** The count per file, clean files left out, keys sorted: the shape of `web/src/glue-baseline.json`. */
export function glueCounts(files: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const path of Object.keys(files).sort()) {
    const count = glueSpots(path, files[path] ?? '').length
    if (count > 0) counts[path] = count
  }
  return counts
}
