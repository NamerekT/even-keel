import { useEffect, useState, type ReactNode } from 'react'
import type { BranchDrift, RemoteBranchList, RepoBranches } from '../../../src/state.js'
import { branchTexts } from '../i18n/branch.js'
import { say } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { noticeId, NoticeButtons } from '../layout/NoticeButtons.js'
import { Band } from '../ui/blocks.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import type { StripLine } from '../ui/fieldStripFit.js'
import { SuggestField } from '../ui/SuggestField.js'
import { branchOffers, cloneLine, moveLine, remoteOffers } from './branchLines.js'

/**
 * The main checkout's branches for the settings (BTN-754): read again once the project's branch or its drift changes,
 * off the top bar — the field shows its own loader when opened meanwhile (BTN-1257).
 */
export function useRepoBranches(project: string, branch: string, drift: BranchDrift | undefined): { repo: RepoBranches | null; reading: boolean } {
  const { read } = useLive()
  const [found, setFound] = useState<RepoBranches | null>(null)
  const [reading, setReading] = useState(true)
  const driftKey = drift === undefined ? '' : `${drift.branch}\n${drift.current ?? ''}`
  useEffect(() => {
    let live = true
    setReading(true)
    const done = (repo: RepoBranches | null) => {
      if (!live) return
      setFound(repo)
      setReading(false)
    }
    read<RepoBranches>('project/branches', { project }).then(done, () => done(null))
    return () => {
      live = false
    }
  }, [project, branch, driftKey])
  return { repo: found, reading }
}

/** The most rows the branch list shows: a repository may have thousands of branches. */
const BRANCH_ROWS = 100

interface BranchFieldProps {
  id: string
  value: string
  repo: RepoBranches | null
  /** A clone's remote, read (BTN-1096): its branches are offered instead of the checkout's. */
  remote?: RemoteBranchList
  /** The branches are still read. */
  loading?: boolean
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  /** What saving does to the checkout, glued under the field (`branchStrip`). */
  line?: StripLine | null
}

/** The main branch with the checkout's branches offered, or a clone's remote's. */
export function BranchField({ id, value, repo, remote, loading, onChange, placeholder, invalid, disabled, line = null }: BranchFieldProps) {
  return (
    <FieldStrip line={line} fold wide>
    <SuggestField
      id={id}
      className="settings__text settings__text--mono"
      mono
      value={value}
      options={remote === undefined ? branchOffers(repo) : remoteOffers(remote)}
      loading={remote === undefined && loading}
      limit={BRANCH_ROWS}
      placeholder={placeholder}
      invalid={invalid}
      disabled={disabled}
      onChange={onChange}
    />
    </FieldStrip>
  )
}

/** What saving the field does to the checkout, as the strip under the field; for a clone, which branch it takes. */
export function branchStrip(repo: RepoBranches | null, remote: RemoteBranchList | undefined, value: string): StripLine | null {
  const lines = remote !== undefined
    ? [cloneLine(remote, value), remote.total > remote.branches.length ? branchTexts().many(remote.total) : null]
    : [moveLine(repo, value)]
  const shown = lines.filter((line) => line !== null)
  return shown.length === 0 ? null : { tone: 'plain', text: shown.join(' ') }
}

/**
 * The checkout moved off the project's branch by hand, with the two ways to make them one again; over the chain it also
 * takes "Got it" and "Don't show again" (`closable`, BTN-759), under the branch field it stays. Of a `machine`
 * elsewhere, its folder of the project (BTN-1567): the buttons go to that machine, `lead` says whose folder it is.
 */
export function BranchDriftBand({ project, drift, closable = false, machine, lead }: { project: string; drift: BranchDrift; closable?: boolean; machine?: string; lead?: ReactNode }) {
  const { send, failure } = useCommand()
  const texts = branchTexts()
  const target = machine === undefined ? { project } : { project, machine }
  return (
    <>
      <Band
        tone="warn"
        action={
          <>
            {drift.current !== null && (
              <button type="button" className="button button--small" onClick={() => void send('project/branch/adopt', target)}>
                {texts.adopt(drift.current)}
              </button>
            )}
            <button type="button" className="button button--small" onClick={() => void send('project/branch/restore', target)}>
              {texts.restore(drift.branch)}
            </button>
            {closable && <NoticeButtons stamps={{ [noticeId('branch.drift', project)]: JSON.stringify(drift) }} kind="branch.drift" project={project} small />}
          </>
        }
      >
        {lead === undefined ? texts.drift(drift.current, drift.branch) : <span><strong>{lead}</strong>: {texts.drift(drift.current, drift.branch)}. {texts.held}</span>}
      </Band>
      {failure !== null && <Band tone="error">{say(failure)}</Band>}
    </>
  )
}
