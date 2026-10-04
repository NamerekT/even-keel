import { useLive } from '../live/context.js'

export function ConfigBanner() {
  const { state } = useLive()
  if (state === null || state.configError === null) return null

  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__inner">
        <span>even-keel.config.json не применён, работает последний исправный: {state.configError}</span>
      </div>
    </div>
  )
}
