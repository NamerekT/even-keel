import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hulyClient } from './client.js'
import { collabUpdater, type CollabModules } from './collab.js'

const require = createRequire(import.meta.url)
// The package exports only its index: its own files are reached by path.
const lib = dirname(require.resolve('@hcengineering/api-client'))
const modules: CollabModules = {
  ...hulyClient.require<Pick<CollabModules, 'markdownToMarkup'>>('@hcengineering/text-markdown'),
  ...hulyClient.require<Pick<CollabModules, 'jsonToMarkup'>>('@hcengineering/text-core'),
}

describe('collabUpdater', () => {
  it("writes Markdown through the pinned client's own collaborator, with its link addresses", async () => {
    const { createMarkupOperations } = require(join(lib, 'markup', 'client.js')) as {
      createMarkupOperations(url: string, workspace: string, token: string, config: Record<string, string>): { collaborator: { updateMarkup: () => Promise<void> } }
    }
    const markup = createMarkupOperations('https://huly.example.com', 'ws-1', 'token', { COLLABORATOR_URL: 'https://huly.example.com/collaborator' })
    const update = vi.spyOn(markup.collaborator, 'updateMarkup').mockResolvedValue(undefined)
    await collabUpdater({ markup }, modules)('tracker:class:Issue', 'id-1', 'description', '# Goal\n\nOne **line**.', 'markdown')
    const json = modules.markdownToMarkup('# Goal\n\nOne **line**.', { refUrl: 'https://huly.example.com/browse?workspace=ws-1', imageUrl: 'https://huly.example.com/files?workspace=ws-1&file=' })
    expect(update).toHaveBeenCalledWith({ objectClass: 'tracker:class:Issue', objectId: 'id-1', objectAttr: 'description' }, modules.jsonToMarkup(json))
  })

  it('finds the markup operations where the pinned client keeps them', () => {
    const source = readFileSync(join(lib, 'client.js'), 'utf8')
    expect(source).toMatch(/this\.markup = \(0, \w+\.createMarkupOperations\)/)
  })

  it('fails loudly on a client without them', async () => {
    await expect(collabUpdater({}, modules)('c', 'id', 'description', 'text', 'markdown')).rejects.toThrow(/no collaborator/)
  })
})
