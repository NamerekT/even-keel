import { describe, expect, it } from 'vitest'
import type { Git } from '../git/types.js'
import { IssueTemplateReader, isIssueTemplate, isOwnRepo, readIssueTemplates, templateHits, templateLabels } from './templates.js'

describe('isIssueTemplate', () => {
  it.each([
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature.md',
    '.github/issue_template.md',
    '.gitea/ISSUE_TEMPLATE/bug.yaml',
    '.forgejo/issue_template/bug.md',
    '.gitlab/issue_templates/Bug.md',
  ])('takes %s', (path) => expect(isIssueTemplate(path)).toBe(true))

  it.each(['.github/ISSUE_TEMPLATE/config.yml', '.github/workflows/ci.yml', 'docs/ISSUE_TEMPLATE/bug.md', '.gitlab/issue_templates/sub/Bug.md', 'README.md'])(
    'leaves %s',
    (path) => expect(isIssueTemplate(path)).toBe(false),
  )
})

describe('templateLabels', () => {
  it('reads an issue form list, inline and as a block', () => {
    expect(templateLabels('.github/ISSUE_TEMPLATE/bug.yml', 'name: Bug\nlabels: ["bug", triage]\nbody:\n  - type: textarea\n')).toEqual(['bug', 'triage'])
    expect(templateLabels('.github/ISSUE_TEMPLATE/bug.yml', 'name: Bug\r\nlabels:\r\n  - bug\r\n  - "needs triage"\r\nbody: []\r\n')).toEqual(['bug', 'needs triage'])
  })

  it('reads a Markdown template front matter, a comma string included', () => {
    expect(templateLabels('.github/ISSUE_TEMPLATE/feature.md', "---\nname: Feature\nlabels: enhancement, 'good first issue'\n---\nText labels: no\n")).toEqual([
      'enhancement',
      'good first issue',
    ])
    expect(templateLabels('.github/ISSUE_TEMPLATE/feature.md', '# No front matter\nlabels: bug\n')).toEqual([])
  })

  it('takes no labels from a nested key or a comment', () => {
    expect(templateLabels('.github/ISSUE_TEMPLATE/bug.yml', 'name: Bug\nbody:\n  - type: dropdown\n    labels: [nested]\n# labels: [comment]\n')).toEqual([])
  })

  it('reads the /label quick action of a GitLab description template', () => {
    expect(templateLabels('.gitlab/issue_templates/Bug.md', 'Steps\n\n/label ~bug ~"needs triage" ~priority::high\n/assign @someone\n')).toEqual([
      'bug',
      'needs triage',
      'priority::high',
    ])
  })
})

describe('templateHits', () => {
  it('names each label a template sets, whatever its case', () => {
    const templates = [{ path: '.github/ISSUE_TEMPLATE/bug.yml', labels: ['Bug'] }, { path: '.github/ISSUE_TEMPLATE/idea.md', labels: ['idea'] }]
    expect(templateHits(templates, ['bug', 'ready'])).toEqual([{ label: 'bug', template: '.github/ISSUE_TEMPLATE/bug.yml' }])
    expect(templateHits(templates, [])).toEqual([])
  })
})

describe('readIssueTemplates', () => {
  it("reads the branch's templates through git", async () => {
    const files: Record<string, string> = {
      '.github/ISSUE_TEMPLATE/bug.yml': 'labels: [bug]\n',
      '.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: false\n',
      '.gitlab/issue_templates/Idea.md': '/label ~idea\n',
    }
    const git: Git = async (_repo, args) => {
      if (args[0] === 'ls-tree') return { code: 0, out: `${Object.keys(files).join('\n')}\nsrc/main.ts\n` }
      const path = args[1]!.slice('trunk:'.length)
      return files[path] === undefined ? { code: 128, out: 'missing' } : { code: 0, out: files[path] }
    }
    expect(await readIssueTemplates(git, 'repo', 'trunk')).toEqual([
      { path: '.github/ISSUE_TEMPLATE/bug.yml', labels: ['bug'] },
      { path: '.gitlab/issue_templates/Idea.md', labels: ['idea'] },
    ])
  })

  it('answers null when the branch cannot be read', async () => {
    expect(await readIssueTemplates(async () => ({ code: 128, out: 'not a tree' }), 'repo', 'missing')).toBeNull()
  })
})

describe('isOwnRepo', () => {
  const remotes = [{ url: 'git@github.com:Example/App.git' }, { url: 'https://gitlab.example.com/group/sub/tool.git' }]
  it.each([
    ['example/app', true],
    ['group/sub/tool', true],
    ['other/app', false],
    ['app', false],
  ])('%s → %s', (place, own) => expect(isOwnRepo(remotes, place)).toBe(own))
})

describe('IssueTemplateReader', () => {
  it('reads the templates again only after the branch moves', async () => {
    let commit = 'aaa'
    const calls: string[][] = []
    const git: Git = async (_repo, args) => {
      calls.push(args)
      if (args[0] === 'rev-parse') return commit === '' ? { code: 1, out: '' } : { code: 0, out: `${commit}\n` }
      if (args[0] === 'ls-tree') return { code: 0, out: '.github/ISSUE_TEMPLATE/bug.yml\n' }
      return { code: 0, out: `labels: [${commit}]\n` }
    }
    const reader = new IssueTemplateReader(git)
    expect(await reader.read('repo', 'main')).toEqual([{ path: '.github/ISSUE_TEMPLATE/bug.yml', labels: ['aaa'] }])
    await reader.read('repo', 'main')
    expect(calls.filter((args) => args[0] === 'ls-tree')).toHaveLength(1)
    commit = 'bbb'
    expect(await reader.read('repo', 'main')).toEqual([{ path: '.github/ISSUE_TEMPLATE/bug.yml', labels: ['bbb'] }])
    commit = ''
    expect(await reader.read('repo', 'main')).toBeNull()
  })
})
