import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { notice } from '../../../src/notice/notice.js'
import type { Overage } from '../../../src/limits/overage.js'
import { usingOverage } from '../../../src/limits/overage.js'
import { formatAgo } from '../format.js'
import { language, overageTexts, say } from '../i18n/index.js'
import { Band } from '../ui/blocks.js'
import { Tipped } from '../ui/Tipped.js'
import './overage.css'

export function overageValue(extra: Overage | undefined): string {
  const texts = overageTexts()
  if (extra === undefined) return '—'
  const number = (value: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value)
  if (extra.balance !== undefined) return texts.credits(number(extra.balance))
  if (extra.used !== undefined) return texts.spent(new Intl.NumberFormat(language, { style: 'currency', currency: 'USD' }).format(extra.used))
  if (extra.unlimited) return texts.unlimited
  if (extra.enabled !== undefined) return extra.enabled ? texts.on : texts.off
  return extra.available === undefined ? '—' : extra.available ? texts.available : texts.unavailable
}

function extraTip(extra: Overage | undefined, now: Date): string {
  const texts = overageTexts()
  if (extra === undefined) return texts.unknown
  return [texts.sources[extra.source], formatAgo(extra.updatedAt, now),
    extra.count === undefined ? null : texts.count(String(extra.count)), texts.autoReload].filter(Boolean).join(' · ')
}

export function OverageValue({ entry, now }: { entry: AccountEntry; now: Date }) {
  return <Tipped className="account-overage" tip={extraTip(entry.limits?.overage, now)} align="start" focusable>{overageValue(entry.limits?.overage)}</Tipped>
}

export function OverageWarning({ entry, view }: { entry: AccountEntry; view: AccountView }) {
  const extra = entry.limits?.overage
  const provider = extra?.source === 'claude-sdk' && extra.available === true ? 'claude' :
    extra?.source === 'chatgpt' && (extra.available === true || extra.unlimited === true) ? 'chatgpt' :
    extra?.source === 'github-quota' && extra.enabled === true ? 'github' : null
  if (provider === null || entry.needsLogin) return null
  const chain = view.pool.some((each) => each.account === entry.key) || entry.projects.length > 0
  const tip = [say(notice('account.overagePolicy', {})), chain ? say(notice('account.overageAdvice', { provider })) : null].filter(Boolean).join(' ')
  const url = provider === 'claude' ? 'https://claude.ai/settings/usage' : provider === 'chatgpt' ? 'https://chatgpt.com/codex/settings/usage' : 'https://github.com/settings/billing'
  return <Band tone="warn" className="account-overage-warning" action={
    <a className="button button--small" href={url} target="_blank" rel="noreferrer">{say(notice('account.overageSettings', {}))}</a>
  }>
    <Tipped focusable tip={tip} align="start">{say(notice('account.overageRisk', {}))}</Tipped>
  </Band>
}

export function OverageChip({ entry, now, plain = false }: { entry: AccountEntry | undefined; now: Date; plain?: boolean }) {
  if (entry === undefined || !usingOverage(entry, now)) return null
  const texts = overageTexts()
  const tip = [entry.limits?.overage?.source === 'chatgpt' ? texts.inferred : texts.confirmed, extraTip(entry.limits?.overage, now)].join(' · ')
  return plain ? <span className="account-overage-chip" aria-label={`${texts.spending}: ${tip}`}>{texts.spending}</span> :
    <Tipped inline focusable className="account-overage-chip" tip={tip} align="start">{texts.spending}</Tipped>
}
