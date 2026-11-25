import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n/index.js'
import { CheckIcon, CopyIcon } from './icons.js'
import { Tipped } from './Tipped.js'
import './codeBlock.css'

/** How long the check stays after a copy; a press on it copies again and starts this anew. */
export const COPIED_MS = 10_000

/**
 * A fenced code block of rendered markdown (the `pre` of `react-markdown`) with a copy button in its top right corner:
 * shown on hover where the pointer hovers, always on a touch screen, and while the check is up.
 * Plain HTTP from another host has no clipboard: there the block has no button, as `CommandBlock`.
 */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const text = useRef<HTMLPreElement>(null)
  // The number of the copy whose check is up, 0 for none: a new copy is a new number, so its timer starts anew.
  const [copy, setCopy] = useState(0)
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined

  useEffect(() => {
    if (copy === 0) return
    const timer = window.setTimeout(() => setCopy(0), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copy])

  const press = () => {
    const value = (text.current?.textContent ?? '').replace(/\n+$/, '')
    navigator.clipboard.writeText(value).then(
      () => setCopy((last) => last + 1),
      () => undefined,
    )
  }
  const copied = copy !== 0
  const label = copied ? t.common.commandCopied : t.common.copyCode
  return (
    <div className={copied ? 'ui-code ui-code--copied' : 'ui-code'}>
      <pre ref={text} className={canCopy ? 'ui-code__text ui-code__text--copy' : 'ui-code__text'}>
        {children}
      </pre>
      {canCopy && (
        <Tipped tip={label} className="ui-code__copy">
          <button type="button" className="ui-code__button" aria-label={label} onClick={press}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </Tipped>
      )}
    </div>
  )
}
