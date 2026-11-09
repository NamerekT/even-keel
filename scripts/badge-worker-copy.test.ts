import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BADGE_WORKER_COPY, badgeWorkerCopyFiles } from './badge-worker-copy.js'

const root = join(import.meta.dirname, '..')
const text = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

function listed(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
    .sort()
}

describe('the Worker’s copy of src/badge', () => {
  const files = badgeWorkerCopyFiles(root)

  it('takes renderBadge with everything it imports and the fonts’ licenses, nothing of the service', () => {
    expect(files.map((file) => file.name).sort()).toEqual(['fonts.generated.ts', 'fonts/Inter-OFL.txt', 'fonts/JetBrainsMono-OFL.txt', 'model.ts', 'render.ts', 'text.ts', 'theme.ts'])
  })

  it('matches src/badge: after a change there run `npm run badge-worker`', () => {
    for (const file of files) expect(text(join(root, BADGE_WORKER_COPY, file.name)), file.name).toBe(text(file.from))
    expect(listed(join(root, BADGE_WORKER_COPY))).toEqual(files.map((file) => file.name).sort())
  })
})
