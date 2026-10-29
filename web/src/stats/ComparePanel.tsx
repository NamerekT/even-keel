import { useState } from 'react'
import type { CompareQuery } from '../../../src/stats/rules.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Fold } from '../ui/Fold.js'
import { HelpTip } from '../pages/settingsParts.js'
import { AnswerNotice, loadedData, useStatsAnswer } from './common.js'
import { modelLabel } from './format.js'
import { COMPARE_DAYS, RuleCompare } from './RuleCompare.js'

type Models = Pick<CompareQuery, 'beforeModels' | 'afterModels'>

function ModelPicker({ title, value, options, onChange }: { title: string; value: string[] | null; options: string[]; onChange: (models: string[] | null) => void }) {
  return <Fold className="compare-models__side" summary={<><strong>{title}</strong><span>{value === null ? t.stats.all : value.length === 0 ? '—' : value.map(modelLabel).join(', ')}</span></>}>
    <div className="rule-chips" role="group" aria-label={title}>
      <button className={value === null ? 'rule-chip rule-chip--on' : 'rule-chip'} aria-pressed={value === null} onClick={() => onChange(null)}>{t.stats.all}</button>
      {options.map(model => <button key={model} className={value?.includes(model) ? 'rule-chip rule-chip--on' : 'rule-chip'} aria-pressed={value?.includes(model) ?? false} onClick={() => onChange(value === null ? [model] : value.includes(model) ? value.filter(each => each !== model) : [...value, model])}>{modelLabel(model)}</button>)}
    </div>
  </Fold>
}

interface Props {
  query: Omit<CompareQuery, 'days'>
  defaultDays: number
  models: Models
  onModels: (next: Models) => void
  options: string[]
}

export function ComparePanel(props: Props) {
  const beside = props.query.from !== undefined
  const [open, setOpen] = useState(props.models.beforeModels != null || props.models.afterModels != null)
  if (beside) return <Fold className="rule-card" summary={<span className="rule-card__title">{t.stats.compare.beside}</span>} open={open} onOpenChange={setOpen}>
    {() => <CompareBody {...props} />}
  </Fold>
  return <div className="rule-card"><CompareBody {...props} /></div>
}

function CompareBody({ query, defaultDays, models, onModels, options }: Props) {
  const [days, setDays] = useState(defaultDays)
  const { statsCompare } = useLive()
  const full = { ...query, ...models, days }
  const key = JSON.stringify(full)
  const loaded = useStatsAnswer(key, () => statsCompare(full), false)
  const compare = loadedData(loaded)
  const beside = query.from !== undefined
  const available = [...new Set([...options, ...(models.beforeModels ?? []), ...(models.afterModels ?? [])])].sort()
  const same = models.beforeModels != null && models.afterModels != null && [...models.beforeModels].sort().join(',') === [...models.afterModels].sort().join(',')
  return <div className="rule-compare">
    {!beside && <header className="rule-card__head">
      <h3 className="rule-card__title">{t.stats.rules.compare}</h3>
      <HelpTip text={t.stats.compare.foot} />
      <div className="segmented" role="group" aria-label={t.stats.rules.days}>
        {COMPARE_DAYS.map(each => <button key={each} type="button" className={each === days ? 'segmented__item segmented__item--on' : 'segmented__item'} aria-pressed={each === days} onClick={() => setDays(each)}>{t.stats.rules.dayCount(each)}</button>)}
      </div>
    </header>}
    {beside && <HelpTip text={t.stats.compare.foot} />}
    <div className="compare-models">
      <ModelPicker title={beside ? t.stats.compare.left : t.stats.compare.before} value={models.beforeModels ?? null} options={available} onChange={beforeModels => onModels({ beforeModels })} />
      <ModelPicker title={beside ? t.stats.compare.right : t.stats.compare.after} value={models.afterModels ?? null} options={available} onChange={afterModels => onModels({ afterModels })} />
    </div>
    {compare === null || loaded?.key !== key ? <AnswerNotice loaded={loaded?.key === key ? loaded : null} /> : <RuleCompare compare={same ? { ...compare, modelShift: false } : compare} beside={beside} />}
  </div>
}
