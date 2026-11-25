import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvenKeelConfig } from '../config.js'
import type { Git } from '../git/types.js'
import { createMenuSource } from './menuSource.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ek-menu-source-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function source(own: Record<string, boolean>) {
  const plugin = join(root, 'pkg')
  mkdirSync(join(plugin, 'skills', 'lint'), { recursive: true })
  writeFileSync(join(plugin, 'skills', 'lint', 'SKILL.md'), '---\ndescription: Lint the code\n---\n')
  const pluginFolders = vi.fn((_project: string, _task: string | null, _own?: Record<string, boolean>) => [{ plugin: 'tools', dir: plugin }])
  const chatPackages = vi.fn(async (_chat: string) => own)
  const menu = createMenuSource({
    config: () => ({ projects: { project: join(root, 'repo') } }) as unknown as EvenKeelConfig,
    packages: { pluginFolders },
    globalDir: join(root, 'global'),
    trim: () => false,
    git: (async () => '') as unknown as Git,
    branchOf: () => 'main',
    chatPackages,
  })
  return { menu, pluginFolders, chatPackages }
}

describe('createMenuSource', () => {
  it("builds a project chat's menu on the chat's own choice of packages (BTN-1716)", async () => {
    const own = { 'tools@example': true, 'extra@example': false }
    const { menu, pluginFolders, chatPackages } = source(own)
    expect((await menu('project', null, 'chat-1')).map((entry) => entry.name)).toEqual(['tools:lint'])
    expect(chatPackages).toHaveBeenCalledWith('chat-1')
    expect(pluginFolders).toHaveBeenCalledWith('project', null, own)
  })

  it("builds a task's menu on the task's set, asking no chat", async () => {
    const { menu, pluginFolders, chatPackages } = source({})
    await menu('project', 'ABC-1', null)
    expect(chatPackages).not.toHaveBeenCalled()
    expect(pluginFolders).toHaveBeenCalledWith('project', 'ABC-1', {})
  })
})
