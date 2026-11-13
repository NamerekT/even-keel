import { useEffect, useState } from 'react'
import type { BranchDrift, RemoteBranchList, RepoBranches } from '../../../src/state.js'
import { branchTexts } from '../i18n/branch.js'
import { say } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { noticeId, NoticeButtons } from '../layout/NoticeButtons.js'
import { Band } from '../ui/blocks.js'
import { SuggestField } from '../ui/SuggestField.js'
import { branchOffers, cloneLine, moveLine, remoteOffers } from './branchLines.js'

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

/** The most rows the branch list shows: a repository may have thousands of branches. */
const BRANCH_ROWS = 100

interface BranchFieldProps {
  id: string
  value: string
  repo: RepoBranches | null
  /** A clone's remote, read (BTN-1096): its branches are offered instead of the checkout's. */
  remote?: RemoteBranchList
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}

/** The main branch with the checkout's branches offered, or a clone's remote's. */
export function BranchField({ id, value, repo, remote, onChange, placeholder, invalid, disabled }: BranchFieldProps) {
  return (
    <SuggestField
      id={id}
      className="settings__text settings__text--mono"
      mono
      value={value}
      options={remote === undefined ? branchOffers(repo) : remoteOffers(remote)}
      limit={BRANCH_ROWS}
      placeholder={placeholder}
      invalid={invalid}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

/** What saving the field does to the checkout, under the field's row; for a clone, which branch it takes. */
export function BranchMoveLine({ repo, remote, value }: { repo: RepoBranches | null; remote?: RemoteBranchList; value: string }) {
  if (remote !== undefined) {
    const lines = [cloneLine(remote, value), remote.total > remote.branches.length ? branchTexts().many(remote.total) : null].filter((line) => line !== null)
    if (lines.length === 0) return null
    return (
      <p className="settings__hint">
        {lines.map((line, index) => (
          <span key={line}>
            {index > 0 && <br />}
            {line}
          </span>
        ))}
      </p>
    )
  }
  const line = moveLine(repo, value)
  return line === null ? null : <p className="settings__hint">{line}</p>
}

/**
 * The checkout moved off the project's branch by hand, with the two ways to make them one again; over the chain it also
 * takes "Got it" and "Don't show again" (`closable`, BTN-759), under the branch field it stays.
 */
export function BranchDriftBand({ project, drift, closable = false }: { project: string; drift: BranchDrift; closable?: boolean }) {
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
            {closable && <NoticeButtons stamps={{ [noticeId('branch.drift', project)]: JSON.stringify(drift) }} kind="branch.drift" project={project} small />}
          </>
        }
      >
        {texts.drift(drift.current, drift.branch)}
      </Band>
      {failure !== null && <Band tone="error">{say(failure)}</Band>}
    </>
  )
}
