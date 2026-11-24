import { useEffect, useState } from 'react'
import { noticeOf } from '../../../src/notice/notice.js'
import type { FolderProbe } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import type { StripLine } from '../ui/fieldStripFit.js'
import { machineFolder, separatorOf, type FolderPick } from './machinePicks.js'
import './settings.css'
import './folderField.css'

const PROBE_DELAY_MS = 500

/**
 * A folder to ask a machine about (`machines/folder`): against the remote of a project not made yet, or against a
 * project's own remotes. `id` names its answer.
 */
export type FolderAsk = { id: string; machine: string; folder: string } & ({ remote: string } | { project: string })

/**
 * What each folder is now (BTN-1297, BTN-1298), asked of its machine a moment after it stops changing; an ask absent
 * from the answers is being asked.
 */
export function useFolderAnswers(asks: FolderAsk[]): Record<string, FolderProbe | undefined> {
  const { read } = useLive()
  const [answers, setAnswers] = useState<Record<string, FolderProbe>>({})
  const keyed = asks.map(({ id, ...body }) => ({ id, body, key: JSON.stringify(body) }))
  const asked = JSON.stringify(keyed.map((each) => each.key))
  useEffect(() => {
    const fresh = keyed.filter((each) => answers[each.key] === undefined)
    if (fresh.length === 0) return
    let live = true
    const timer = setTimeout(() => {
      for (const each of fresh) {
        read<FolderProbe>('machines/folder', each.body).then(
          (probe) => live && setAnswers((before) => ({ ...before, [each.key]: probe })),
          (error: unknown) => live && setAnswers((before) => ({ ...before, [each.key]: { state: 'taken', notice: noticeOf(error) } })),
        )
      }
    }, PROBE_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // The asks' keys stand for the asks.
  }, [asked])
  return Object.fromEntries(keyed.map((each) => [each.id, answers[each.key]]))
}

export interface MachineFolderFieldProps {
  /** The fields' labels: the name's field and the full path's. */
  labels: { folder: string; path: string }
  /** Its folder of projects; `null` — not reported, so only a full path can be named. */
  root: string | null
  pick: FolderPick
  /** The folder's name when none is typed: the hub's. */
  hubName: string
  probe: FolderProbe | undefined
  disabled?: boolean
  onChange: (patch: Partial<FolderPick>) => void
}

/**
 * A project's folder on a machine elsewhere (BTN-1297, BTN-1298): the machine's folder of projects and a name in it,
 * or a full path behind "another folder…", and what is there now — free for a clone, the project's clone to take, or
 * taken with what to do. The folder decides between a clone and a clone already there; there is no switch.
 */
export function MachineFolderField({ labels, root, pick, hubName, probe, disabled = false, onChange }: MachineFolderFieldProps) {
  const other = pick.other || root === null
  const folder = machineFolder(pick, { root }, hubName)
  const invalid = probe?.state === 'taken' || undefined
  return (
    <>
      <FieldStrip line={stripOf(folder, probe)} wide>
      {other ? (
        <input
          className="settings__text settings__text--mono"
          aria-label={labels.path}
          autoComplete="off"
          spellCheck={false}
          value={pick.path}
          placeholder={t.pool.wizard.pathPlaceholder}
          aria-invalid={invalid}
          disabled={disabled}
          onChange={(event) => onChange({ path: event.target.value })}
        />
      ) : (
        <span className="project-add__folder">
          <span className="project-add__dir" title={root}>
            <bdi dir="ltr">
              {root.replace(/[\\/]+$/, '')}
              {separatorOf(root)}
            </bdi>
          </span>
          <input
            className="settings__text settings__text--mono project-add__name"
            aria-label={labels.folder}
            autoComplete="off"
            spellCheck={false}
            value={pick.folder}
            placeholder={hubName}
            aria-invalid={invalid}
            disabled={disabled}
            onChange={(event) => onChange({ folder: event.target.value })}
          />
        </span>
      )}
      </FieldStrip>
      {root !== null && (
        <button type="button" className="link-button project-add__other" disabled={disabled} onClick={() => onChange({ other: !pick.other })}>
          {pick.other ? t.pool.wizard.rootFolder : t.creation.other}
        </button>
      )}
    </>
  )
}

/** What the folder is now, as the strip under it; nothing while there is no folder to ask about. */
function stripOf(folder: string | null, probe: FolderProbe | undefined): StripLine | null {
  if (folder === null) return null
  if (probe === undefined) return { tone: 'plain', text: t.wizard.checking }
  if (probe.state === 'taken') return { tone: 'error', text: say(probe.notice) }
  return { tone: 'ok', text: probe.state === 'clone' && probe.notice !== undefined ? say(probe.notice) : t.pool.wizard.states[probe.state] }
}
