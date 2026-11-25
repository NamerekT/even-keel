import { useState } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { ConfigConflictView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { Tipped } from '../ui/Tipped.js'
import { Banner } from './Banner.js'
import './configConflict.css'

/** Of a version's first differing line, this many characters stand in the banner; the tip holds the whole text. */
const SHOWN = 60

/**
 * A hook or `settings.json` of the global configuration changed on two machines (BTN-1692): no session merges them, a
 * person picks the version. One line per file: what happened and where, the two versions as their first differing
 * line with the whole text in a tip, "Keep this" and "Take the other". The choice is a commit of the hub's copy of the
 * configuration, so the conflict ends on every machine; no "Got it", it stays until chosen or the file is saved again.
 */
export function ConfigConflictBanner() {
  const { state } = useLive()
  const conflicts = state?.configConflicts ?? []
  if (conflicts.length === 0) return <Banner />
  return (
    <Banner>
      {conflicts.map((conflict) => (
        <ConflictLine key={`${conflict.file}@${conflict.hash}`} conflict={conflict} />
      ))}
    </Banner>
  )
}

function ConflictLine({ conflict }: { conflict: ConfigConflictView }) {
  const { command } = useLive()
  const [sending, setSending] = useState<'kept' | 'other' | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [kept, other] = differingLines(conflict.kept, conflict.other)

  const choose = async (take: 'kept' | 'other') => {
    setSending(take)
    setFailure(null)
    try {
      await command('config/settleConflict', { file: conflict.file, hash: conflict.hash, take })
    } catch (error) {
      setFailure(noticeOf(error))
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="banner__inner config-conflict">
      <span>{say(failure ?? conflict.notice)}</span>
      <span className="config-conflict__versions">
        <Version label={t.banner.configKeptVersion} line={kept} text={conflict.kept} />
        <Version label={t.banner.configOtherVersion} line={other} text={conflict.other} />
      </span>
      <span className="banner__actions">
        <button type="button" className="button button--small" disabled={sending !== null} onClick={() => void choose('kept')}>
          {t.banner.configKeep}
        </button>
        <button type="button" className="button button--small" disabled={sending !== null} onClick={() => void choose('other')}>
          {t.banner.configTakeOther}
        </button>
      </span>
    </div>
  )
}

function Version({ label, line, text }: { label: string; line: string; text: string }) {
  return (
    <Tipped className="config-conflict__version" focusable inline tip={<span className="config-conflict__full">{text === '' ? t.banner.configEmpty : text}</span>}>
      <span className="config-conflict__label">{label}</span>
      <code className="config-conflict__line">{line === '' ? t.banner.configEmpty : line}</code>
    </Tipped>
  )
}

/** The first line where the two texts part, each cut to `SHOWN`: what tells the versions apart at a glance. */
export function differingLines(a: string, b: string): [string, string] {
  const one = a.split(/\r?\n/)
  const two = b.split(/\r?\n/)
  let at = 0
  while (at < Math.max(one.length, two.length) && one[at] === two[at]) at++
  const cut = (line: string | undefined) => {
    const text = (line ?? '').trim()
    return text.length > SHOWN ? `${text.slice(0, SHOWN - 1)}…` : text
  }
  return [cut(one[at]), cut(two[at])]
}
