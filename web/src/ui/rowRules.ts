/**
 * The guard of the one-column settings form (docs/design.md, "Settings form", BTN-1727): every `<Row …control={…}>` of
 * `web/src` whose control is not a `<Switch>` — a control at the right of its name, where a setting now stands under
 * it (`Field`). A switch alone keeps its name's line. Used by `web/src/design.test.ts` and `scripts/design-baseline.ts`.
 */
import ts from 'typescript'

export interface RowSpot {
  line: number
}

/** Whether a path under `web/src` is page code the guard reads: `settingsParts.tsx` defines `Row` and `SwitchField`. */
export function rowScanned(path: string): boolean {
  return path.endsWith('.tsx') && !/\.test\.tsx$/.test(path) && path !== 'pages/settingsParts.tsx' && !/(^|\/)live\/fake[^/]*$/.test(path)
}

/** The JSX element a `control={…}` holds, through parentheses; `undefined` for anything else. */
function elementOf(expression: ts.Expression | undefined): ts.JsxOpeningLikeElement | undefined {
  let node = expression
  while (node !== undefined && ts.isParenthesizedExpression(node)) node = node.expression
  if (node === undefined) return undefined
  if (ts.isJsxElement(node)) return node.openingElement
  if (ts.isJsxSelfClosingElement(node)) return node
  return undefined
}

/** The `<Row>`s of one file whose control sits at the right of the name and is not a switch. */
export function rowSpots(path: string, source: string): RowSpot[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const spots: RowSpot[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'Row') {
      const control = node.attributes.properties.find((each) => ts.isJsxAttribute(each) && each.name.getText(file) === 'control')
      const spread = node.attributes.properties.some((each) => ts.isJsxSpreadAttribute(each))
      if (control !== undefined || spread) {
        const value = control !== undefined && ts.isJsxAttribute(control) && control.initializer !== undefined && ts.isJsxExpression(control.initializer) ? control.initializer.expression : undefined
        const element = elementOf(value)
        if (element === undefined || element.tagName.getText(file) !== 'Switch') {
          spots.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 })
        }
      }
    }
    node.forEachChild(visit)
  }
  visit(file)
  return spots
}

/** The count per file, clean files left out, keys sorted: the shape of `web/src/row-baseline.json`. */
export function rowCounts(files: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const path of Object.keys(files).sort()) {
    const count = rowSpots(path, files[path] ?? '').length
    if (count > 0) counts[path] = count
  }
  return counts
}
