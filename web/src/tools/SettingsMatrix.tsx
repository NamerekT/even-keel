import { Fold } from '../ui/Fold.js'
import type { CSSProperties, ReactNode } from 'react'
import type { SettingKind, SettingRow, ToolScope, ToolsView } from '../../../src/tools/model.js'
import { t } from '../i18n/index.js'
import { useProjectLabel } from '../ui/ProjectLabel.js'
import { HIDDEN, filterRows, localDeny, scopeMarks, settingMatrix, tone, usedScopes, type Tone } from './matrix.js'

type Section = 'claude' | 'plugin' | 'skill' | 'permission' | 'codex'

const SECTIONS: [Section, SettingKind[]][] = [
  ['claude', ['sync', 'mode']],
  ['plugin', ['plugin']],
  ['skill', ['skill']],
  ['permission', ['permission']],
  ['codex', ['codex']],
]

export function SettingsMatrix({ views, query, onlyDiff }: { views: ToolsView[]; query: string; onlyDiff: boolean }) {
  const projects = views.map((view) => view.project)

  return (
    <>
      <p className="tools__muted">{t.tools.legend}</p>
      {SECTIONS.map(([section, kinds]) => {
        const all = settingMatrix(views, kinds)
        if (all.length === 0) return null
        const rows = filterRows(all, { query, onlyDiff })
        const scopes = usedScopes(all)
        const chip = Math.max(...all.flatMap((row) => row.cells.map((cell) => (cell === null ? 0 : cellText(cell).length))))
        return (
          <MatrixSection
            key={section}
            title={t.tools.section[section]}
            note={section === 'codex' ? t.tools.codexNote : undefined}
            shown={rows.length}
            total={all.length}
            projects={projects}
            chip={chip}
          >
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <code>{row.name}</code>
                </th>
                {row.cells.map((cell, index) => (
                  <td key={projects[index]}>{cell === null ? <Missing /> : <SettingCell row={cell} scopes={scopes} />}</td>
                ))}
              </tr>
            ))}
          </MatrixSection>
        )
      })}
    </>
  )
}

interface SectionProps {
  title: string
  /** A line under the title, for a section whose scopes mean something else than the legend says. */
  note?: string
  shown: number
  total: number
  projects: string[]
  /** The longest value of the section in characters: every row keeps that much room for its chip. */
  chip?: number
  children: ReactNode
}

function MatrixSection({ title, note, shown, total, projects, chip, children }: SectionProps) {
  const label = useProjectLabel()
  return (
    <Fold className="tools__section" defaultOpen summaryClassName="tools__summary" summary={<>
      {title} <span className="tools__count">{t.tools.shown(shown, total)}</span>
    </>}>
      {() => (
        <>
          {note !== undefined && <p className="tools__muted">{note}</p>}{shown === 0 ? (
            <p className="tools__muted">{t.tools.nothingShown}</p>
          ) : (
            <div className="tools__scroll">
              <table className="tools__matrix" style={chip === undefined ? undefined : ({ '--chip': chip } as CSSProperties)}>
                <thead>
                  <tr>
                    <th />
                    {projects.map((project) => (
                      <th key={project} scope="col">
                        {label(project)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{children}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Fold>
  )
}

export function valueText(value: string | null): string {
  if (value === null) return t.tools.notInSession
  return value === HIDDEN ? t.tools.hidden : value
}

export function Chip({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  return (
    <span className={`tools__chip tools__chip--${tone}`} title={title}>
      {children}
    </span>
  )
}

/** A deny or an ask only `settings.local.json` has names itself: "not reached" alone hides that the session runs unguarded. */
function cellText(row: SettingRow): string {
  return localDeny(row) ? t.tools.localDenied(row.values.local!) : valueText(row.session)
}

function SettingCell({ row, scopes }: { row: SettingRow; scopes: ToolScope[] }) {
  const marks = scopeMarks(row)
  return (
    <span className="tools__cell">
      <span className="tools__value">
        <Chip tone={tone(row.session)} title={localDeny(row) ? t.tools.localDenyTip : undefined}>
          {cellText(row)}
        </Chip>
      </span>
      <span className="tools__scopes">
        {scopes.map((scope) => {
          const mark = marks.find((each) => each.scope === scope)
          return mark === undefined ? (
            <span key={scope} className="tools__scope" aria-hidden="true" />
          ) : (
            <span
              key={scope}
              className={`tools__scope tools__scope--${mark.effect}`}
              title={`${t.tools.scopeName[scope]}: ${valueText(mark.value)} — ${t.tools.effect[mark.effect]}`}
            >
              {t.tools.scopeShort[scope]}
            </span>
          )
        })}
      </span>
    </span>
  )
}

function Missing() {
  return (
    <span className="tools__missing" title={t.tools.missing}>
      —
    </span>
  )
}
