import { useEffect, useState } from 'react'
import type { BranchDrift, RepoBranches } from '../../../src/state.js'
import { branchTexts } from '../i18n/branch.js'
import { say } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { Band } from '../ui/blocks.js'
import { SuggestField } from '../ui/SuggestField.js'
import { branchOffers, moveLine } from './branchLines.js'

/** The main checkout's branches for the settings (BTN-754): read again once the project's branch or its drift changes. */
export function useRepoBranches(project: string, branch: string, drift: BranchDrift | undefined): RepoBranches | null {
  const { query } = useLive()
  const [found, setFound] = useState<RepoBranches | null>(null)
  const driftKey = drift === undefined ? '' : `${drift.branch}\n${drift.current ?? ''}`
  useEffect(() => {
    let live = true
    query<RepoBranches>('project/branches', { project }).then(
      (read) => live && setFound(read),
      () => live && setFound(null),
    )
    return () => {
      live = false
    }
  }, [project, branch, driftKey])
  return found
}

interface BranchFieldProps {
  id: string
  value: string
  repo: RepoBranches | null
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}

/** The main branch with the checkout's branches offered. */
export function BranchField({ id, value, repo, onChange, placeholder, invalid, disabled }: BranchFieldProps) {
  return (
    <SuggestField
      id={id}
      className="settings__text settings__text--mono"
      mono
      value={value}
      options={branchOffers(repo)}
      placeholder={placeholder}
      invalid={invalid}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

/** What saving the field does to the checkout, under the field's row. */
export function BranchMoveLine({ repo, value }: { repo: RepoBranches | null; value: string }) {
  const line = moveLine(repo, value)
  return line === null ? null : <p className="settings__hint">{line}</p>
}

/** The checkout moved off the project's branch by hand, with the two ways to make them one again. */
export function BranchDriftBand({ project, drift }: { project: string; drift: BranchDrift }) {
  const { send, failure } = useCommand()
  const texts = branchTexts()
  return (
    <>
      <Band
        tone="warn"
        action={
          <>
            {drift.current !== null && (
              <button type="button" className="button button--small" onClick={() => void send('project/branch/adopt', { project })}>
                {texts.adopt(drift.current)}
              </button>
            )}
            <button type="button" className="button button--small" onClick={() => void send('project/branch/restore', { project })}>
              {texts.restore(drift.branch)}
            </button>
          </>
        }
      >
        {texts.drift(drift.current, drift.branch)}
      </Band>
      {failure !== null && <Band tone="error">{say(failure)}</Band>}
    </>
  )
}
