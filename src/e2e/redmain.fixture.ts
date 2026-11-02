import { commitAndMerge, type Turn } from './agent.fixture.js'
import type { Outcome } from './ci.fixture.js'
import { type Harness, PROJECT_ID } from './service.fixture.js'

/** A red main under a task's session, for `ci-fix.test.ts` and `ci-sessions.test.ts`. */

/** The task of the fix session when `ci.fixTask` is off. */
export const FIX = 'ABC-FIX'

export const chainOf = (run: Harness) => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)

export const callsOf = (run: Harness, kind: 'launch' | 'resume' | 'stop', task?: string) =>
  run.agent.calls.filter((call) => call.kind === kind && (task === undefined || call.task === task))

/**
 * ABC-1 lands and its run stays under way; ABC-2 starts once `waitMinutes` runs out and plays `turns`. The fix
 * session plays `fixer` and merges a commit whose run comes out as `fixed`.
 */
export async function underTask(run: Harness, fixed: Outcome, fixer: Turn, ...turns: Turn[]): Promise<void> {
  run.project.ci = { waitMinutes: 1 }
  run.board.add('ABC-1')
  run.board.add('ABC-2', 'ABC-1')
  run.agent.script('ABC-1', commitAndMerge('one.txt'))
  run.agent.script('ABC-2', ...turns)
  run.agent.script(FIX, fixer)
  run.ci.outcome = (subject) => (subject.includes('ABC-1') ? 'running' : subject.includes(FIX) ? fixed : 'success')
  await run.start()
  await run.startChain(PROJECT_ID)
  await run.until(() => callsOf(run, 'launch', 'ABC-2').length === 1 && run.ci.runOf('ABC-1') !== undefined, 'ABC-2 launched while the run of ABC-1 is under way')
}

/** Commits what the session left uncommitted, merges main and lands the task. */
export const goOn: Turn = async (turn) => {
  await turn.git('add', '-A')
  await turn.git('merge', '--no-edit', 'main')
  return commitAndMerge('two.txt')(turn)
}
