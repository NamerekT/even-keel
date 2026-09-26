import { useLive } from '../live/context.js'

export function LinkBanner() {
  const { state, link, retryNow } = useLive()
  if (link !== 'stale' || state === null) return null

  return (
    <div className="banner" role="alert">
      <div className="banner__inner">
        <span>Данные устарели: нет связи с сервером, переподключаюсь.</span>
        <button type="button" className="button" onClick={retryNow}>
          Повторить
        </button>
      </div>
    </div>
  )
}
