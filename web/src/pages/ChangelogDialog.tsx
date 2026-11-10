import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { diffSection, type DiffLine } from '../../../src/changelog/diff.js'
import type { AccountEntry } from '../../../src/account/model.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { TokenTotals } from '../../../src/sessions/transcript.js'
import type { ChangelogSpend, ChangelogSpent, ChangelogView } from '../../../src/state.js'
import { sinceWritten, unaccounted } from '../changelog.js'
import { formatElapsed, formatMoment, formatTokens } from '../format.js'
import { say, t } from '../i18n/index.js'
import { accountName } from '../accountName.js'
import { useLive } from '../live/context.js'
import { Segmented } from '../stats/common.js'
import { formatUsd, modelVersionLabel } from '../stats/format.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { DiffLines } from '../ui/DiffLines.js'
import { ChangelogIcon } from '../ui/icons.js'
import { Loading } from '../ui/Loader.js'
import { SessionMarkdown } from '../ui/SessionMarkdown.js'
import { Tipped } from '../ui/Tipped.js'
import '../stats/overview.css'
import '../tools/addPackage.css'
import './changelog.css'

const COPIED_MS = 2000
const SHORT_COMMIT = 7

type Op = 'open' | 'draft' | 'again' | 'add' | 'edit' | 'write'

/** How the section shows: rendered, or its Markdown with the version's changes marked. One choice for every milestone. */
type Look = 'preview' | 'markdown'
const LOOK_KEY = 'even-keel.changelog.look'

function storedLook(): Look {
  try {
    return localStorage.getItem(LOOK_KEY) === 'markdown' ? 'markdown' : 'preview'
  } catch {
    return 'preview'
  }
}

/**
 * The milestone head's button: opens the changelog draft of the milestone; next to it, the done tasks closed since it was
 * written. None for a project without git: its folder has no branch to commit the file to, and its tasks change no code.
 */
export function ChangelogButton({ project, milestone }: { project: string; milestone: string }) {
  const { state } = useLive()
  const [open, setOpen] = useState(false)
  if (state?.config.projects[project]?.git === false) return null
  const since = state === null ? null : sinceWritten(state, project, milestone)
  return (
    <>
      {since !== null && since > 0 && (
        <Tipped tip={t.changelog.sinceTip} inline focusable className="chain__changelog-since">
          {t.changelog.since(since)}
        </Tipped>
      )}
      <Tipped tip={t.changelog.button} inline>
        <button type="button" className="chain__changelog" aria-label={t.changelog.button} onClick={() => setOpen(true)}>
          <ChangelogIcon />
        </button>
      </Tipped>
      {open && createPortal(<ChangelogDialog project={project} milestone={milestone} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

interface DialogProps {
  project: string
  milestone: string
  onClose: () => void
}

/**
 * The milestone's changelog section: its newest version with what it changed marked, an edit in words, adding the
 * tasks closed since, writing it again, copying it and writing it to the file with a commit.
 */
function ChangelogDialog({ project, milestone, onClose }: DialogProps) {
  const { query, state } = useLive()
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const title = useId()
  const [view, setView] = useState<ChangelogView | null>(null)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [busy, setBusy] = useState<Op | null>(null)
  const [copied, setCopied] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [look, setLook] = useState<Look>(storedLook)
  const alive = useRef(true)

  const pickLook = (next: Look) => {
    setLook(next)
    try {
      localStorage.setItem(LOOK_KEY, next)
    } catch {
      // A browser that keeps no storage keeps the choice until the dialog closes.
    }
  }

  const run = async (op: Op) => {
    setBusy(op)
    setFailure(null)
    try {
      const answer = await query<ChangelogView>(`changelog/${op}`, { project, milestone, ...(op === 'edit' ? { instruction } : {}) })
      if (!alive.current) return
      setView(answer)
      if (op === 'edit') setInstruction('')
    } catch (error) {
      if (alive.current) setFailure(noticeOf(error))
    } finally {
      if (alive.current) setBusy(null)
    }
  }

  useEffect(() => {
    alive.current = true
    if (dialog.current?.open === false) dialog.current.showModal()
    void run('open')
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const version = view?.version ?? null
  const start = view?.start ?? null
  const text = version?.text ?? start?.section ?? null
  const missing = version === null || state === null ? 0 : unaccounted(state.tasks, project, milestone, version.tasks).length
  const idle = busy === null
  const nothingDone = version === null && start?.done === 0

  const copy = async () => {
    if (version === null) return
    try {
      await navigator.clipboard.writeText(version.text)
    } catch {
      // Plain HTTP from another host has no clipboard API: copy the old way, from a field inside the modal dialog.
      const area = document.createElement('textarea')
      area.value = version.text
      dialog.current?.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
  }

  return (
    <dialog
      ref={dialog}
      className="add-package changelog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {t.changelog.title(milestone)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.packages.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body changelog__body">
          <Loading
            busy={busy !== null && busy !== 'write'}
            label={busy === 'open' ? t.changelog.opening : busy === 'draft' || busy === 'again' ? t.changelog.writing : t.changelog.working}
            fit="fill"
          >
            {view !== null && (version !== null || start !== null) && (
              <>
                <p className="changelog__counts">
                  {version !== null ? t.changelog.counts(version.tasks.length, version.open) : t.changelog.startCounts(start!.done, start!.open)}
                </p>
                {view.released !== null && <p className="changelog__counts">{t.changelog.released(view.released)}</p>}
                <div className="changelog__status">
                  <span className="changelog__at">
                    {version === null
                      ? start?.section === null
                        ? t.changelog.noSection(view.file)
                        : t.changelog.inFile(view.file)
                      : version.written === null
                        ? t.changelog.at(version.number, formatMoment(version.at, new Date()))
                        : t.changelog.written(view.file, version.written.commit.slice(0, SHORT_COMMIT))}
                  </span>
                  {text !== null && (
                    <Segmented
                      label={t.changelog.look}
                      options={[
                        ['preview', t.changelog.preview],
                        ['markdown', t.changelog.markdown],
                      ]}
                      value={look}
                      onChange={pickLook}
                    />
                  )}
                </div>
                {version?.instruction != null && <p className="changelog__instruction">{t.changelog.instruction(version.instruction)}</p>}
                {text === null ? (
                  <div className="changelog__text changelog__none">{t.changelog.none(start?.done ?? 0)}</div>
                ) : look === 'preview' ? (
                  <div className="changelog__text changelog__preview" role="document" aria-label={t.changelog.title(milestone)} tabIndex={0}>
                    <SessionMarkdown text={text} />
                  </div>
                ) : (
                  <Section lines={diffSection(version?.base ?? null, text)} label={t.changelog.title(milestone)} />
                )}
                {version !== null && (
                  <textarea
                    className="changelog__edit"
                    rows={2}
                    value={instruction}
                    placeholder={t.changelog.editHint}
                    aria-label={t.changelog.edit}
                    disabled={!idle}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                      event.preventDefault()
                      if (instruction.trim() !== '') void run('edit')
                    }}
                  />
                )}
              </>
            )}
          </Loading>
          {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        </div>
        <footer className="add-package__foot changelog__foot">
          {view === null && busy === 'open' ? null : version === null ? (
            <>
              {nothingDone && <span className="changelog__reason">{t.changelog.noDone}</span>}
              <span className="add-package__spacer" />
              <button
                type="button"
                className="button button--primary"
                disabled={!idle}
                aria-disabled={nothingDone || undefined}
                aria-busy={busy === 'draft'}
                onClick={() => {
                  if (!nothingDone) void run('draft')
                }}
              >
                {t.changelog.draft}
              </button>
            </>
          ) : (
            <>
              {view !== null && (version.spend !== null || view.spent.turns > 0) && (
                <Spend spend={version.spend} spent={view.spent} accounts={state?.account.accounts ?? []} />
              )}
              <span className="add-package__spacer" />
              {missing > 0 && (
                <Tipped tip={t.changelog.addTip} inline>
                  <button type="button" className="button" disabled={!idle} onClick={() => void run('add')}>
                    {t.changelog.add(missing)}
                  </button>
                </Tipped>
              )}
              <button type="button" className="button" disabled={!idle} onClick={() => void run('again')}>
                {t.changelog.again}
              </button>
              <button type="button" className="button" disabled={!idle} onClick={() => void copy()}>
                {copied ? t.changelog.copied : t.changelog.copy}
              </button>
              <Tipped tip={t.changelog.writeTip(view?.file ?? '')} inline off={view === null}>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={version.written !== null || !idle}
                  aria-busy={busy === 'write'}
                  onClick={() => void run('write')}
                >
                  {t.changelog.write}
                </button>
              </Tipped>
            </>
          )}
        </footer>
      </div>
    </dialog>
  )
}

const allTokens = (tokens: TokenTotals) => tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite

/** A cost, or the tokens where the agent counts none (Codex). */
const costText = (cost: number | null, tokens: TokenTotals) => (cost !== null ? formatUsd(cost) : t.changelog.tokens(formatTokens(allTokens(tokens))))

/**
 * What the version's turn cost and, past one turn, the milestone's all together; pointed at, whose limits or credit
 * paid it, the model, the tokens by kind and the time.
 */
function Spend({ spend, spent, accounts }: { spend: ChangelogSpend | null; spent: ChangelogSpent; accounts: AccountEntry[] }) {
  const entry = spend === null ? undefined : accounts.find((each) => each.key === spend.account)
  const total = spent.unpriced === spent.turns ? costText(null, spent.tokens) : formatUsd(spent.cost)
  const label = [spend === null ? '' : costText(spend.cost, spend.tokens), spent.turns > 1 || spend === null ? t.changelog.spentAll(total) : '']
    .filter((part) => part !== '')
    .join(' · ')
  const tip = (
    <>
      {spend !== null && (
        <>
          <span className="tip__head">
            {[entry === undefined ? spend.account : accountName(entry, accounts), spend.model === null ? '' : modelVersionLabel(spend.model), formatElapsed(spend.durationMs)]
              .filter((part) => part !== '')
              .join(' · ')}
          </span>
          <span>{t.changelog.tokensDetail(formatTokens(spend.tokens.input), formatTokens(spend.tokens.output), formatTokens(spend.tokens.cacheRead), formatTokens(spend.tokens.cacheWrite))}</span>
          <span>{entry?.apiKey === true ? t.changelog.paidByKey : spend.cost === null ? t.changelog.paidByLimitsNoCost : t.changelog.paidByLimits}</span>
        </>
      )}
      {spent.turns > 0 && <span>{t.changelog.spentTotal(spent.turns, total, spent.unpriced === spent.turns ? 0 : spent.unpriced)}</span>}
      <span className="tip__muted">{t.changelog.notInStats}</span>
    </>
  )
  return (
    <Tipped tip={tip} inline focusable align="start" className="changelog__spend">
      {label}
    </Tipped>
  )
}

/** The section, line by line: added lines green, removed ones struck through, a changed line with its replaced words marked. */
function Section({ lines, label }: { lines: DiffLine[]; label: string }) {
  return (
    <div className="changelog__text" role="document" aria-label={label} tabIndex={0}>
      <DiffLines lines={lines} />
    </div>
  )
}
