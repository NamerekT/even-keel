import type { ChangelogDraft } from '../../../src/changelog/drafts.js'
import { fail } from '../../../src/notice/notice.js'

const WRITE_MS = 2500

const TEXT = `## [0.2.0] - 2026-10-20

### Added

- A changelog draft for every milestone, written by the agent from the milestone's closed tasks.
- Linear projects can be added from the wizard.

### Changed

- The chain shows how full the context is before a session starts.

### Fixed

- A question asked right before a limit is no longer lost.

---

Not in \`Unreleased\` of CHANGELOG.md: ABC-3, ABC-7.`

/**
 * `milestone/changelog`: a draft after a short wait; `again` waits as long.
 * `?changelog=failed|empty|slow` — the agent fails, the milestone has no done task, writing never ends.
 */
export async function fakeChangelog(name: string, body: Record<string, unknown>, param: string | null): Promise<ChangelogDraft | null> {
  if (name !== 'milestone/changelog') return null
  const project = String(body.project)
  const milestone = String(body.milestone)
  if (param === 'slow') await new Promise(() => {})
  await new Promise((resolve) => setTimeout(resolve, WRITE_MS))
  if (param === 'empty') throw fail('changelog.empty', { milestone })
  if (param === 'failed') throw fail('changelog.failed', { project }, { detail: 'claude exited with 1' })
  return { project, milestone, text: TEXT, done: 6, open: 2, at: new Date().toISOString() }
}
