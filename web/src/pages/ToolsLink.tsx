import { Link } from 'react-router'
import { t } from '../i18n/index.js'
import { problemCount, problemsOf } from '../tools/matrix.js'
import { useToolsViews } from '../tools/useToolsViews.js'
import '../tools/tools.css'

export function ToolsLink({ project, trim }: { project: string; trim: boolean }) {
  const loaded = useToolsViews([project], trim).get(project)
  const count = loaded?.state === 'ready' && loaded.view !== null ? problemCount(problemsOf(loaded.view)) : null

  return (
    <p className={count !== null && count > 0 ? 'tools-link tools-link--warn' : 'tools-link'}>
      <span>{t.tools.link(count)}</span>
      <Link to={`/tools?projects=${encodeURIComponent(project)}`}>{t.tools.open}</Link>
    </p>
  )
}
