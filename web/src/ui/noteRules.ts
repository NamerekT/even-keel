/**
 * The guard of "An explanation is a "?", not a line under the field" (docs/design.md, BTN-1590): every element of `web/src`
 * whose class is a note or a hint (`add-package__note`, `settings__hint`, `add-package__kind-hint`, `task-card__run-note`)
 * as a spot with its line. A class is read from any string or template of the code, so one kept in a variable or picked
 * by a condition counts too; a literal counts once however many such classes it names. Used by
 * `web/src/design.test.ts` and `scripts/design-baseline.ts`.
 */
import ts from 'typescript'

export interface NoteSpot {
  line: number
  className: string
}

export interface NoteException {
  /** The file under `web/src`. */
  file: string
  /** The element's own class: a literal naming it is let through, whatever other classes it holds. */
  className: string
  why: string
}

/**
 * The lines that stay on view under a field: a short warning without which something that cannot be undone is easy to
 * break, each with its reason. A state — a check's answer, an error — is a field strip (`FieldStrip`), not an exception.
 */
export const NOTE_EXCEPTIONS: NoteException[] = []

/** A note's or a hint's class; `--modifiers` of one ride on its base class. */
const NOTE = /^[a-z][a-z0-9_-]*(?:__|-)(?:note|hint)$/
/** A line inside a tip, where an explanation belongs: `panel__tip-note`, `mark-tip__hint`. */
const IN_TIP = /(^|[_-])tip([_-]|$)/

/** Whether a path under `web/src` is page code the guard reads; the guard's own classes are its rules. */
export function noteScanned(path: string): boolean {
  if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path) || path.endsWith('.d.ts') || path === 'ui/noteRules.ts') return false
  return !/(^|\/)live\/fake[^/]*$/.test(path)
}

const literalKinds = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
])

/** The notes and hints of one file under `web/src`, a spot per literal that names one, the listed exceptions left out. */
export function noteSpots(path: string, source: string, exceptions: NoteException[] = NOTE_EXCEPTIONS): NoteSpot[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const excepted = new Set(exceptions.filter((each) => each.file === path).map((each) => each.className))
  const spots: NoteSpot[] = []
  const visit = (node: ts.Node): void => {
    if (literalKinds.has(node.kind)) {
      const classes = (node as ts.LiteralLikeNode).text.split(/\s+/)
      const found = classes.find((each) => NOTE.test(each) && !IN_TIP.test(each))
      if (found !== undefined && !classes.some((each) => excepted.has(each))) {
        spots.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, className: found })
      }
    }
    node.forEachChild(visit)
  }
  visit(file)
  return spots
}

/** The count per file, clean files left out, keys sorted: the shape of `web/src/note-baseline.json`. */
export function noteCounts(files: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const path of Object.keys(files).sort()) {
    const count = noteSpots(path, files[path] ?? '').length
    if (count > 0) counts[path] = count
  }
  return counts
}
