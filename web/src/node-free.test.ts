import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// The page is built for the browser: a module of `node:*` reached from it leaves the whole page blank (BTN-1523).
// Read from the disk, not through `import.meta.glob`: vitest's module cache freezes a glob's file list.
const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(webRoot, '../..')
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
const isTest = (file: string) => /\.test\.tsx?$/.test(file)
const entries = walk(webRoot).filter((file) => /\.tsx?$/.test(file) && !isTest(file) && !file.endsWith('.d.ts'))

/** The specifiers a module loads at run time: type-only imports and re-exports are erased by the build. */
export function valueImports(source: string, name = 'module.ts'): string[] {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, false, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)))
      if (!typeOnly) found.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      const typeOnly = node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly))
      if (!typeOnly) found.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments
      if (arg !== undefined && ts.isStringLiteral(arg)) found.push(arg.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** The source file a relative specifier names, as the bundler resolves `.js` to `.ts`/`.tsx`; `null` for anything else. */
function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(from), specifier.replace(/\?.*$/, ''))
  const stem = base.replace(/\.(m?js|jsx)$/, '')
  return [base, `${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((path) => /\.tsx?$/.test(path) && existsSync(path)) ?? null
}

/** Every Node built-in the page reaches, with the import path that brings it in. */
function nodeImports(): string[] {
  const seen = new Map<string, string[]>()
  const queue = entries.map((file) => ({ file, path: [file] }))
  const found: string[] = []
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next.file)) continue
    seen.set(next.file, next.path)
    for (const specifier of valueImports(readFileSync(next.file, 'utf8'), next.file)) {
      if (specifier.startsWith('node:')) {
        found.push(`${specifier} ← ${next.path.map((file) => relative(repoRoot, file).replaceAll('\\', '/')).join(' ← ')}`)
        continue
      }
      const target = resolveLocal(next.file, specifier)
      if (target !== null && !isTest(target)) queue.push({ file: target, path: [target, ...next.path] })
    }
  }
  return found
}

describe('the page code', () => {
  it('reaches no node:* module, through web/src or src/', () => {
    expect(nodeImports()).toEqual([])
  })
})

describe('valueImports', () => {
  it('skips what the build erases', () => {
    const source = [
      "import type { A } from './a.js'",
      "import { type B } from './b.js'",
      "export type { C } from './c.js'",
      "import { D, type E } from './d.js'",
      "import './e.css'",
      "export { F } from './f.js'",
      "const g = () => import('./g.js')",
    ].join('\n')
    expect(valueImports(source)).toEqual(['./d.js', './e.css', './f.js', './g.js'])
  })
})
