import { t } from '../i18n/index.js'
import { shortModel } from './modelLabel.js'
import './modelName.css'

/**
 * A model's short name (`shortModel`) in `className`, the span its place cuts with an ellipsis, and the `free` badge
 * after it for OpenRouter's `:free`; the full name and id stay for the tip of what holds it (`modelTip`), so the badge
 * has no `title` of its own.
 */
export function ModelName({ model, title, className }: { model: string; title?: string | null; className: string }) {
  const { name, free } = shortModel(model, title)
  return (
    <>
      <span className={className}>{name}</span>
      {free && <span className="tag model-free">{t.session.modelFree}</span>}
    </>
  )
}
