import type { AccountDrift, ToolScope, ToolsView } from '../../../src/tools/model.js'
import { folderLabel } from '../accountName.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { projectLabel } from '../state.js'
import { Band } from '../ui/blocks.js'
import { PROBLEM_KINDS, sharedProblems, type SharedProblem } from './matrix.js'
import { Chip, valueText } from './SettingsMatrix.js'

/** A problem without project keys is in every chosen project. */
export function Problems({ views, accounts }: { views: ToolsView[]; accounts: AccountDrift[] }) {
  const { state } = useLive()
  const found = sharedProblems(views)
  if (found.length === 0 && accounts.length === 0) return <Band tone="note">{t.tools.problemsNone}</Band>

  return (
    <Band tone="warn" className="tools__problems">
      <h2 className="tools__heading">{t.tools.problems}</h2>
      {PROBLEM_KINDS.map((kind) => {
        const problems = found.filter((each) => each.kind === kind)
        if (problems.length === 0) return null
        return (
          <div key={kind} className="tools__problem">
            <p className="tools__problem-label">{t.tools.problem[kind]}</p>
            <p className="tools__problem-fix">{t.tools.problemFix[kind]}</p>
            <div className="tools__chips">
              {problems.map((problem) => (
                <Chip key={`${problem.row?.kind ?? ''}:${problem.name}`} tone="lost" title={titleOf(problem)}>
                  {problem.name}
                  {problem.projects.length < views.length && (
                    <span className="tools__where">{problem.projects.map((project) => projectLabel(state, project)).join(', ')}</span>
                  )}
                </Chip>
              ))}
            </div>
          </div>
        )
      })}
      {accounts.length > 0 && (
        <div className="tools__problem">
          <p className="tools__problem-label">{t.tools.accounts}</p>
          <p className="tools__problem-fix">{t.tools.problemFix.accounts}</p>
          <ul className="tools__list">
            {accounts.map((drift) => (
              <li key={drift.account} title={drift.account}>{t.tools.drift(folderLabel(state?.account, drift.account), drift.keys.join(', '))}</li>
            ))}
          </ul>
        </div>
      )}
    </Band>
  )
}

function titleOf(problem: SharedProblem): string | undefined {
  if (problem.row === null) return undefined
  return Object.entries(problem.row.values)
    .map(([scope, value]) => `${t.tools.scopeName[scope as ToolScope]}: ${valueText(value)}`)
    .join(', ')
}
