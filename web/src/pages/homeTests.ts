import type { EvenKeelState } from '../../../src/state.js'

export interface HomeTests {
  /** The test projects among those given, the ones the switch is about; the demo's is none of them. */
  tests: string[]
  hidden: number
  /** The projects the home page lays out as cards. */
  visible: string[]
}

/**
 * The home page's "Test projects" switch (BTN-1364): while it is off, the test projects' cards are left out. The demo
 * is a test project too (BTN-776), but it is the tour the page starts with, so it is never hidden.
 */
export function homeTests(state: Pick<EvenKeelState, 'config' | 'demo' | 'showTests'>, projects: string[]): HomeTests {
  const tests = projects.filter((id) => state.config.projects[id]?.testProject === true && id !== state.demo?.project)
  if (state.showTests.home) return { tests, hidden: 0, visible: projects }
  return { tests, hidden: tests.length, visible: projects.filter((id) => !tests.includes(id)) }
}
