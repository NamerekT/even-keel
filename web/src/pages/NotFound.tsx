import { Link } from 'react-router'
import { t } from '../i18n/index.js'
import { Basement } from '../layout/Basement.js'

export function NotFound({ what }: { what?: string }) {
  return (
    <Basement tall ready sign={[t.notFound.title, what ?? t.notFound.page]}>
      <Link to="/">{t.notFound.back}</Link>
    </Basement>
  )
}
