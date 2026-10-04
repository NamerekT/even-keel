import { Link } from 'react-router'
import { t } from '../i18n/index.js'

export function NotFound({ what }: { what?: string }) {
  return (
    <section className="page">
      <h1 className="page__title">{t.notFound.title}</h1>
      <p className="placeholder">
        {what ?? t.notFound.page} <Link to="/">{t.notFound.back}</Link>
      </p>
    </section>
  )
}
