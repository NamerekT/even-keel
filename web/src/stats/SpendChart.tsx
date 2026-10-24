import { useEffect, useRef, useState, type RefObject } from 'react'
import { t } from '../i18n/index.js'
import { Card } from '../ui/blocks.js'
import { seriesStyle } from '../ui/series.js'
import { Segmented } from './common.js'
import { formatShare, formatUsd } from './format.js'
import type { ChartData, Metric } from './history.js'
import { markKey, markTitle, type MarkPlace } from './marks.js'
import { MarkTip } from './MarkTip.js'
import { addDays, formatBucket, formatDay, nextBucket, type DayRange, type Step } from './period.js'

const METRICS: Metric[] = ['cost', 'limit', 'sessions']
const STEPS: Step[] = ['day', 'week', 'month']
const MAX_LABELS = 16
const LABEL_WIDTH = 64

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function formatMetric(value: number, metric: Metric): string {
  if (metric === 'cost') return formatUsd(value)
  if (metric === 'limit') return value === 0 ? '0 %' : formatShare(value)
  return String(Math.round(value))
}

function bucketTitle(bucket: string, step: Step, range: DayRange): string {
  if (step === 'day') return formatDay(bucket)
  const last = addDays(nextBucket(bucket, step), -1)
  const from = bucket < range.from ? range.from : bucket
  const to = last > range.to ? range.to : last
  return from === to ? formatDay(from) : `${formatDay(from, false)} — ${formatDay(to)}`
}

export function SpendChart({
  data,
  range,
  step,
  metric,
  onStep,
  onMetric,
  onZoom,
  onZoomOut,
  marks,
  picked,
  onPick,
}: {
  data: ChartData
  range: DayRange
  step: Step
  metric: Metric
  onStep: (step: Step) => void
  onMetric: (metric: Metric) => void
  onZoom: (range: DayRange) => void
  onZoomOut: (() => void) | null
  marks: Map<string, MarkPlace[]>
  picked: string[]
  onPick: (key: string, extend: boolean) => void
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [hoveredMark, setHoveredMark] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const { buckets, series } = data
  const max = Math.max(0, ...buckets.map((each) => each.total))
  const total = buckets.reduce((sum, each) => sum + each.total, 0)
  const [plot, width] = useWidth<HTMLDivElement>()
  const labels = width === 0 ? MAX_LABELS : Math.max(2, Math.min(MAX_LABELS, Math.floor(width / LABEL_WIDTH)))
  const every = Math.ceil(buckets.length / labels)

  useEffect(() => {
    if (drag === null) return
    const finish = () => {
      setDrag(null)
      if (drag.from === drag.to) return
      const first = buckets[Math.min(drag.from, drag.to)]!.bucket
      const last = addDays(nextBucket(buckets[Math.max(drag.from, drag.to)]!.bucket, step), -1)
      onZoom({ from: first < range.from ? range.from : first, to: last > range.to ? range.to : last })
    }
    document.addEventListener('pointerup', finish)
    return () => document.removeEventListener('pointerup', finish)
  }, [drag, buckets, step, range.from, range.to])

  const dragged = (index: number) => drag !== null && index >= Math.min(drag.from, drag.to) && index <= Math.max(drag.from, drag.to)

  return (
    <Card
      className="chart spend"
      title={t.stats.spend.titles[step]}
      titleId="spend-title"
      actions={
        <>
          <Segmented
            label={t.stats.spend.metric}
            options={METRICS.map((each) => [each, ...t.stats.spend.metrics[each]])}
            value={metric}
            onChange={onMetric}
          />
          <Segmented label={t.stats.spend.step} options={STEPS.map((each) => [each, ...t.stats.spend.steps[each]])} value={step} onChange={onStep} />
        </>
      }
    >

      <div ref={plot} className="chart__plot" onMouseLeave={() => setHovered(null)} onDoubleClick={() => onZoomOut?.()}>
        <div className="chart__axis" aria-hidden="true">
          <span>{max > 0 && formatMetric(max, metric)}</span>
          <span>0</span>
        </div>
        <div className="chart__columns spend__columns">
          {total === 0 && <p className="chart__empty">{t.stats.spend.empty}</p>}
          {buckets.map((row, index) => {
            const title = bucketTitle(row.bucket, step, range)
            const side = index < buckets.length / 2 ? 'right' : 'left'
            const places = marks.get(row.bucket) ?? []
            const tipMark = places.find(({ mark }) => markKey(mark) === hoveredMark)?.mark
            return (
              <div
                key={row.bucket}
                className={dragged(index) ? 'chart__column spend__column spend__column--picked' : 'chart__column spend__column'}
                tabIndex={0}
                aria-label={`${title}: ${formatMetric(row.total, metric)}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  setDrag({ from: index, to: index })
                }}
                onPointerEnter={() => {
                  setHovered(index)
                  if (drag !== null) setDrag({ ...drag, to: index })
                }}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
              >
                <div className="chart__track">
                  <div className="chart__stack" style={{ height: max === 0 ? 0 : `${(row.total / max) * 100}%` }}>
                    {series.map((each, at) =>
                      row.values[at]! > 0 ? (
                        <span key={each.key} className="chart__segment" style={{ ...seriesStyle(each.slot), flexGrow: row.values[at] }} />
                      ) : null,
                    )}
                  </div>
                </div>
                {places.map(({ mark, offset }) => {
                  const key = markKey(mark)
                  const on = picked.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      className={on ? 'spend__mark spend__mark--on' : 'spend__mark'}
                      style={{ left: `${offset * 100}%` }}
                      aria-pressed={on}
                      aria-label={t.stats.spend.mark(markTitle(mark))}
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerEnter={() => setHoveredMark(key)}
                      onPointerLeave={() => setHoveredMark(null)}
                      onFocus={() => setHoveredMark(key)}
                      onBlur={() => setHoveredMark(null)}
                      onClick={(event) => onPick(key, event.shiftKey || event.ctrlKey || event.metaKey)}
                    />
                  )
                })}
                <span className="chart__day spend__label">{index % every === 0 ? formatBucket(row.bucket, step) : ' '}</span>
                {tipMark !== undefined && drag === null && <MarkTip mark={tipMark} side={side} />}
                {hovered === index && drag === null && tipMark === undefined && (
                  <div className={`chart__tip chart__tip--${side}`} role="tooltip">
                    <strong>{title}</strong>
                    {series.map((each, at) => ({ each, value: row.values[at]! }))
                      .filter(({ value }) => value > 0)
                      .reverse()
                      .map(({ each, value }) => (
                        <span key={each.key} className="chart__tip-row" style={seriesStyle(each.slot)}>
                          <span className="chart__swatch" aria-hidden="true" />
                          {each.label}
                          <span className="chart__tip-count">{formatMetric(value, metric)}</span>
                        </span>
                      ))}
                    <span className="chart__tip-row spend__tip-total">
                      {t.common.total}
                      <span className="chart__tip-count">{formatMetric(row.total, metric)}</span>
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="spend__hint">
        {t.stats.spend.zoom}
        {onZoomOut !== null && t.stats.spend.zoomOut}.{marks.size > 0 && t.stats.spend.marks}
      </p>
    </Card>
  )
}
