import { describe, expect, it } from 'vitest'
import { answerSection, changelogPath, changelogPlan, milestoneVersion, sectionsOf, withSection } from './file.js'

const FILE = `# Changelog

All notable changes are documented here.

## [Unreleased]

### Added

- The chain.

## [0.1.0] - 2026-10-21

### Added

- The first release.

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/releases/v0.1.0
`

describe('sectionsOf', () => {
  it('names each `## ` section by its version and stops the last one before the link references', () => {
    const sections = sectionsOf(FILE)
    expect(sections.map((section) => [section.name, section.heading])).toEqual([
      ['Unreleased', '## [Unreleased]'],
      ['0.1.0', '## [0.1.0] - 2026-10-21'],
    ])
    expect(sections[0]!.text).toBe('## [Unreleased]\n\n### Added\n\n- The chain.')
    expect(sections[1]!.text).toBe('## [0.1.0] - 2026-10-21\n\n### Added\n\n- The first release.')
  })

  it('takes a heading without brackets by its first word', () => {
    expect(sectionsOf('## Unreleased\n\n- x\n').map((section) => section.name)).toEqual(['Unreleased'])
  })
})

describe('milestoneVersion', () => {
  it('reads a version label and nothing else', () => {
    expect(milestoneVersion('v0.1')).toBe('0.1')
    expect(milestoneVersion(' V1.2.3 ')).toBe('1.2.3')
    expect(milestoneVersion('Sprint 3')).toBeNull()
  })
})

describe('changelogPlan', () => {
  it('takes Unreleased for a milestone with no release yet', () => {
    const plan = changelogPlan(FILE, 'v0.2', ['v0.1.0'])
    expect(plan.section?.name).toBe('Unreleased')
    expect(plan.released).toEqual([])
    expect(plan.tag).toBeNull()
  })

  it('takes a section already named by the version but not tagged', () => {
    const plan = changelogPlan(FILE, 'v0.1', [])
    expect(plan.section?.name).toBe('Unreleased')
    expect(changelogPlan(FILE.replace('## [Unreleased]', '## [0.2.0]'), 'v0.2', ['v0.1.0']).section?.name).toBe('0.2.0')
  })

  it('freezes the section of a tagged version: a new patch section goes on top', () => {
    const plan = changelogPlan(FILE, 'v0.1', ['v0.1.0', 'v0.2.0'])
    expect(plan.section).toBeNull()
    expect(plan.released.map((section) => section.name)).toEqual(['0.1.0'])
    expect(plan.tag).toBe('v0.1.0')
    expect(plan.heading).toBe('## [0.1.1]')
  })

  it('takes an untagged patch section of a released milestone', () => {
    const text = FILE.replace('## [Unreleased]', '## [0.1.1]')
    const plan = changelogPlan(text, 'v0.1', ['v0.1.0'])
    expect(plan.section?.name).toBe('0.1.1')
    expect(plan.released.map((section) => section.name)).toEqual(['0.1.0'])
  })

  it('gives a new Unreleased heading when there is no file', () => {
    expect(changelogPlan(null, 'v0.1', [])).toEqual({ section: null, heading: '## [Unreleased]', released: [], tag: null })
  })

  it('reads a milestone that is not a version only by Unreleased and never freezes it', () => {
    expect(changelogPlan(FILE, 'Sprint 3', ['v0.1.0']).section?.name).toBe('Unreleased')
  })
})

describe('withSection', () => {
  it('replaces the milestone section alone', () => {
    const next = withSection(FILE, changelogPlan(FILE, 'v0.2', ['v0.1.0']), '## [Unreleased]\n\n### Fixed\n\n- A bug.\n')
    expect(next).toBe(FILE.replace('### Added\n\n- The chain.', '### Fixed\n\n- A bug.'))
  })

  it('puts a new section above the previous versions', () => {
    const next = withSection(FILE, changelogPlan(FILE, 'v0.1', ['v0.1.0']), '## [0.1.1]\n\n- A fix.')
    expect(next).toContain('All notable changes are documented here.\n\n## [0.1.1]\n\n- A fix.\n\n## [Unreleased]')
  })

  it('replaces the last section and keeps the link references after it', () => {
    const text = '# Changelog\n\n## [Unreleased]\n\n- Old.\n\n[Unreleased]: https://example.com\n'
    expect(withSection(text, changelogPlan(text, 'v0.1', []), '## [Unreleased]\n\n- New.')).toBe(
      '# Changelog\n\n## [Unreleased]\n\n- New.\n\n[Unreleased]: https://example.com\n',
    )
  })

  it('appends to a file with no section and writes a new file with a header', () => {
    expect(withSection('# Changelog\n', changelogPlan('# Changelog\n', 'v0.1', []), '## [Unreleased]\n\n- New.')).toBe('# Changelog\n\n## [Unreleased]\n\n- New.\n')
    const fresh = withSection(null, changelogPlan(null, 'v0.1', []), '## [Unreleased]\n\n- New.')
    expect(fresh).toMatch(/^# Changelog\n\n.*Keep a Changelog.*\n\n## \[Unreleased\]\n\n- New\.\n$/s)
  })
})

describe('answerSection', () => {
  it('drops a preamble and a code fence and keeps the section', () => {
    expect(answerSection('Here it is:\n\n```markdown\n## [Unreleased]\n\n- New.\n```\n', '## [Unreleased]')).toBe('## [Unreleased]\n\n- New.')
  })

  it('puts the heading on an answer that has none', () => {
    expect(answerSection('### Added\n\n- New.', '## [0.1.1]')).toBe('## [0.1.1]\n\n### Added\n\n- New.')
  })
})

describe('changelogPath', () => {
  it('takes any slashes and trims the outer ones', () => {
    expect(changelogPath('docs\\CHANGELOG.md')).toBe('docs/CHANGELOG.md')
    expect(changelogPath(' /docs//CHANGELOG.md/ ')).toBe('docs/CHANGELOG.md')
    expect(changelogPath('./CHANGELOG.md')).toBe('CHANGELOG.md')
  })

  it('refuses a path out of the repository and an empty one', () => {
    expect(changelogPath('C:\\repos\\CHANGELOG.md')).toBeNull()
    expect(changelogPath('../CHANGELOG.md')).toBeNull()
    expect(changelogPath('docs/../../CHANGELOG.md')).toBeNull()
    expect(changelogPath('~/CHANGELOG.md')).toBeNull()
    expect(changelogPath(' / ')).toBeNull()
  })
})
