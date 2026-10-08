import type { AccountDrift, ToolScope, ToolsView } from '../../../src/tools/model.js'
import { t } from '../i18n/index.js'
import { PROBLEM_KINDS, sharedProblems, type SharedProblem } from './matrix.js'
import { Chip, valueText } from './SettingsMatrix.js'

/** A problem without project keys is in every chosen project. */
export function Problems({ views, accounts }: { views: ToolsView[]; accounts: AccountDrift[] }) {
  const found = sharedProblems(views)
  if (found.length === 0 && accounts.length === 0) return <p className="tools__ok">{t.tools.problemsNone}</p>

  return (
    <section className="tools__problems">
      <h2 className="tools__heading">{t.tools.problems}</h2>
      {PROBLEM_KINDS.map((kind) => {
        const problems = found.filter((each) => each.kind === kind)
        if (problems.length === 0) return null
        return (
          <div key={kind} className="tools__problem">
            <p className="tools__problem-label">{t.tools.problem[kind]}</p>
            <div className="tools__chips">
              {problems.map((problem) => (
                <Chip key={`${problem.row?.kind ?? ''}:${problem.name}`} tone="lost" title={titleOf(problem)}>
                  {problem.name}
                  {problem.projects.length < views.length && <span className="tools__where">{problem.projects.join(', ')}</span>}
                </Chip>
              ))}
            </div>
          </div>
        )
      })}
      {accounts.length > 0 && (
        <div className="tools__problem">
          <p className="tools__problem-label">{t.tools.accounts}</p>
          <ul className="tools__list">
            {accounts.map((drift) => (
              <li key={drift.account}>{t.tools.drift(drift.account, drift.keys.join(', '))}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function titleOf(problem: SharedProblem): string | undefined {
  if (problem.row === null) return undefined
  return Object.entries(problem.row.values)
    .map(([scope, value]) => `${t.tools.scopeName[scope as ToolScope]}: ${valueText(value)}`)
    .join(', ')
}
