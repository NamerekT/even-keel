import type { TaskWork } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { Tipped } from './Tipped.js'

/** What lies in the task's folder and where, a line each; the files left out of a commit come first: they are the easiest to lose. */
export function workLines(work: TaskWork): string[] {
  return [
    ...(work.files > 0 ? [t.chain.work.files(work.files)] : []),
    ...(work.ahead > 0 ? [t.chain.work.commits(work.ahead)] : []),
    work.path,
    t.chain.work.branch(work.branch),
  ]
}

/** Work of a task that no commit of main holds (BTN-298): a red chip, the details and what to do in its tip. */
export function WorkChip({ work }: { work: TaskWork }) {
  const tip = (
    <>
      {workLines(work).map((line) => (
        <span key={line}>{line}</span>
      ))}
      <span>{t.chain.work.fix}</span>
    </>
  )
  return (
    <Tipped tip={tip} inline focusable className="work-tip">
      <span className="chip chip--work">{work.files > 0 ? t.chain.work.uncommitted(work.files) : t.chain.work.unmerged(work.ahead)}</span>
    </Tipped>
  )
}
