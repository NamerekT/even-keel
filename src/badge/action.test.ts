import { describe, expect, it } from 'vitest'
import { badgeActionOf, insideRepo } from './action.js'

const CWD = 'C:\\repos\\example-project'

describe('badgeActionOf', () => {
  it('shows a file tool with its path inside the repository, and only the tool for one outside', () => {
    expect(badgeActionOf('Edit', { file_path: `${CWD}\\src\\a.ts` }, CWD)).toEqual({ tool: 'Edit', text: 'Edit src/a.ts' })
    expect(badgeActionOf('Write', { file_path: 'c:/repos/example-project/docs/b.md' }, CWD)).toEqual({ tool: 'Write', text: 'Write docs/b.md' })
    expect(badgeActionOf('Read', { file_path: 'C:\\Users\\jane\\notes.txt' }, CWD)).toEqual({ tool: 'Read', text: 'Read' })
    expect(badgeActionOf('NotebookEdit', { notebook_path: 'nb/x.ipynb' }, CWD)).toEqual({ tool: 'NotebookEdit', text: 'NotebookEdit nb/x.ipynb' })
    expect(badgeActionOf('Read', { file_path: `${CWD}\\a.ts` }, undefined)).toEqual({ tool: 'Read', text: 'Read' })
  })

  it('shows a command only by its own description, a skill by its name', () => {
    expect(badgeActionOf('Bash', { command: 'rm -rf secret', description: '  Run the\n tests ' }, CWD)).toEqual({ tool: 'Bash', text: 'Bash Run the tests' })
    expect(badgeActionOf('Bash', { command: 'curl https://example.com?token=x' }, CWD)).toEqual({ tool: 'Bash', text: 'Bash' })
    expect(badgeActionOf('PowerShell', { command: 'Get-Item', description: '' }, CWD)).toEqual({ tool: 'PowerShell', text: 'PowerShell' })
    expect(badgeActionOf('Skill', { skill: 'coding' }, CWD)).toEqual({ tool: 'Skill', text: 'Skill coding' })
  })

  it('shows a pattern, a query or an MCP call only by its tool', () => {
    expect(badgeActionOf('Grep', { pattern: 'password' }, CWD)).toEqual({ tool: 'Grep', text: 'Grep' })
    expect(badgeActionOf('WebSearch', { query: 'private matter' }, CWD)).toEqual({ tool: 'WebSearch', text: 'WebSearch' })
    expect(badgeActionOf('mcp__tasks__task_read', { key: 'ABC-1' }, CWD)).toEqual({ tool: 'task_read', text: 'task_read' })
  })

  it('cuts the text to 60 characters with an ellipsis', () => {
    const { text } = badgeActionOf('Bash', { command: 'x', description: 'word '.repeat(30) }, CWD)
    expect([...text]).toHaveLength(60)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('insideRepo', () => {
  it('keeps a relative path, refuses one that climbs out and an absolute one elsewhere', () => {
    expect(insideRepo('./src/a.ts', CWD)).toBe('src/a.ts')
    expect(insideRepo('../other/a.ts', CWD)).toBeNull()
    expect(insideRepo(`${CWD}\\..\\x`, CWD)).toBeNull()
    expect(insideRepo('C:\\repos\\example-project-2\\a.ts', CWD)).toBeNull()
    expect(insideRepo(CWD, CWD)).toBeNull()
    expect(insideRepo('/home/john/a.ts', '/home/john/repo')).toBeNull()
    expect(insideRepo('/home/john/repo/a.ts', '/home/john/repo/')).toBe('a.ts')
  })
})
