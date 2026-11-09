// Builds the package from src/badge into an empty dist/: the compiled drawing, the fonts' licenses and the MIT license.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const here = import.meta.dirname
const root = join(here, '..', '..')
const dist = join(here, 'dist')
const fonts = join(root, 'src', 'badge', 'fonts')

rmSync(dist, { recursive: true, force: true })
execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', join(here, 'tsconfig.json')], { stdio: 'inherit' })
mkdirSync(join(dist, 'fonts'))
for (const name of readdirSync(fonts).filter((name) => name.endsWith('-OFL.txt'))) copyFileSync(join(fonts, name), join(dist, 'fonts', name))
copyFileSync(join(root, 'LICENSE'), join(dist, 'LICENSE'))
