import { Link } from 'react-router'

export function NotFound({ what = 'Такой страницы нет.' }: { what?: string }) {
  return (
    <section className="page">
      <h1 className="page__title">Не найдено</h1>
      <p className="placeholder">
        {what} <Link to="/">К проектам</Link>
      </p>
    </section>
  )
}
