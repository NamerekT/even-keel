import type { CSSProperties } from 'react'
import { t } from '../i18n/index.js'

/** The matrix sections the skeleton imitates and how many rows each gets. */
const SHAPE: [keyof typeof t.tools.section, number][] = [
  ['claude', 2],
  ['plugin', 3],
  ['skill', 4],
  ['permission', 2],
]

const NAME_WIDTHS = [62, 44, 78, 52, 36, 70]

export function ToolsLoading({ projects, ready }: { projects: string[]; ready: (project: string) => boolean }) {
  let row = 0
  return (
    <div className="tools-loading" role="status" aria-label={t.tools.loading}>
      <p className="tools-loading__caption">
        <span className="tools-loading__scanner" aria-hidden="true" />
        {t.tools.loading}
      </p>
      {SHAPE.map(([section, rows]) => (
        <div key={section} className="tools__section tools-loading__section" aria-hidden="true">
          <p className="tools__summary tools-loading__summary">{t.tools.section[section]}</p>
          <table className="tools__matrix">
            <thead>
              <tr>
                <th />
                {projects.map((project) => (
                  <th key={project} className={ready(project) ? 'tools-loading__project tools-loading__project--ready' : 'tools-loading__project'}>
                    {project}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, () => {
                const index = row++
                return (
                  <tr key={index} style={{ '--i': index } as CSSProperties}>
                    <th>
                      <span className="tools-loading__bar" style={{ width: `${NAME_WIDTHS[index % NAME_WIDTHS.length]}%` }} />
                    </th>
                    {projects.map((project) => (
                      <td key={project}>
                        <span className="tools-loading__bar tools-loading__bar--chip" />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
