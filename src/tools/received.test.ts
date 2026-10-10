import { describe, expect, it } from 'vitest'
import { latestStarted, readReceived, skillSource } from './received.js'

const line = (value: unknown) => JSON.stringify(value)
const attachment = (value: Record<string, unknown>) => line({ type: 'attachment', attachment: value })

describe('readReceived', () => {
  it('collects skills, tools and MCP servers from the attachments', () => {
    const lines = [
      line({ type: 'custom-title', customTitle: 'ABC-1', sessionId: 's-1' }),
      attachment({ type: 'skill_listing', isInitial: true, names: ['coding', 'huly:task'], content: '- coding: x\n- huly:task: y' }),
      attachment({ type: 'prompt_snapshot', tools: [{ name: 'Bash' }, { name: 'Read' }] }),
      attachment({ type: 'deferred_tools_delta', addedNames: ['WebFetch', 'Monitor'], removedNames: [], pendingMcpServers: ['plugin:huly:huly'], failedMcpServers: [] }),
      line({ type: 'user', sessionId: 's-1', cwd: 'D:\\abc\\.claude\\worktrees\\abc-1', version: '2.1.290', permissionMode: 'auto', timestamp: '2026-10-06T10:00:00Z' }),
      line({ type: 'assistant', sessionId: 's-1' }),
      attachment({
        type: 'deferred_tools_delta',
        addedNames: ['mcp__plugin_huly_huly__get_issue', 'mcp__plugin_huly_huly__add_comment', 'mcp__forgejo__list'],
        removedNames: ['Monitor'],
        pendingMcpServers: [],
        failedMcpServers: ['linear'],
      }),
    ]
    expect(readReceived(lines)).toEqual({
      sessionId: 's-1',
      cwd: 'D:\\abc\\.claude\\worktrees\\abc-1',
      at: '2026-10-06T10:00:00Z',
      version: '2.1.290',
      mode: 'auto',
      skills: ['coding', 'huly:task'],
      listingChars: 26,
      tools: ['Bash', 'Read', 'WebFetch'],
      mcp: [
        { name: 'forgejo', tools: 1, failed: false },
        { name: 'linear', tools: 0, failed: true },
        { name: 'plugin_huly_huly', tools: 2, failed: false },
      ],
    })
  })

  it('adds the skills of a later listing to the initial ones', () => {
    const lines = [
      attachment({ type: 'skill_listing', isInitial: true, names: ['coding'], content: 'ab' }),
      attachment({ type: 'skill_listing', isInitial: false, names: ['huly:task'], content: 'cde' }),
    ]
    expect(readReceived(lines)).toMatchObject({ skills: ['coding', 'huly:task'], listingChars: 5 })
  })

  it('skips broken lines and returns undefined without any attachment', () => {
    expect(readReceived(['{', line({ type: 'user', cwd: 'D:\\abc' })])).toBeUndefined()
  })
})

describe('skillSource', () => {
  const known = { user: new Set(['coding']), project: new Set(['recon']) }

  it('tells claude.ai, plugin, project, user and bundled skills apart', () => {
    expect(skillSource('anthropic-skills:docx', known)).toBe('claudeai')
    expect(skillSource('huly:task', known)).toBe('plugin')
    expect(skillSource('recon', known)).toBe('project')
    expect(skillSource('coding', known)).toBe('user')
    expect(skillSource('update-config', known)).toBe('bundled')
  })
})

describe('latestStarted', () => {
  const started = (sessionId: string, at: string | null) => ({ ...readReceived([attachment({ type: 'skill_listing', names: [] })])!, sessionId, at })

  it('takes the session that started last, not the first one in the list', () => {
    const list = [started('old-but-touched', '2026-10-09T15:44:14Z'), started('new', '2026-10-09T23:40:21Z'), started('middle', '2026-10-09T22:18:31Z')]
    expect(latestStarted(list)?.sessionId).toBe('new')
  })

  it('keeps the list order for sessions without a start time', () => {
    expect(latestStarted([started('first', null), started('second', null)])?.sessionId).toBe('first')
    expect(latestStarted([started('unknown', null), started('known', '2026-10-09T23:40:21Z')])?.sessionId).toBe('known')
    expect(latestStarted([])).toBeUndefined()
  })
})
