import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectCheck, RepoBranches, SourceRead } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { projectPath } from '../state.js'
import { Segmented } from '../stats/common.js'
import { BranchIcon, ClonesIcon, PlusIcon } from '../ui/icons.js'
import { BranchField, BranchMoveLine } from './BranchField.js'
import { NoticeFixButton } from './FixButtons.js'
import { cloneTyped, folderView, pathTyped, type WizardFields } from './projectWizard.js'
import { RefusalWords } from './RefusalWords.js'
import { isRemoteRefusal } from './remoteRefusal.js'
import { FieldHead, Row } from './settingsParts.js'
import { stepPath } from './setupSteps.js'
import { Status } from './TrackerFields.js'
import { trustTexts } from '../i18n/trust.js'

/**
 * "Make it a repository" under a folder without one, "Make the first commit" under a repository without commits
 * (BTN-731): the service makes the draft's branch born, and the folder is checked again.
 */
function MakeRepository({ repo, branch, exists, onMade }: { repo: string; branch: string; exists: boolean; onMade: () => void }) {
  const { send, sending, failure } = useCommand()
  const make = async () => {
    if (await send('git/init', { repo, branch })) onMade()
  }
  return (
    <div className="project-add__init">
      <button type="button" className="button button--small" disabled={sending} onClick={() => void make()}>
        {exists ? t.wizard.firstCommit : t.wizard.makeRepo}
      </button>
      {failure !== null && (
        <p className="notice notice--error">
          {say(failure)} <NoticeFixButton project={null} notice={failure} onFixed={() => void make()} />
        </p>
      )}
    </div>
  )
}

/** What git on the service's machine allows (BTN-1048): no git — no repository. */
export function gitReadiness(state: EvenKeelState): { missing: boolean } {
  return { missing: state.git?.version === null }
}

interface RepoStepProps {
  state: EvenKeelState
  fields: WizardFields
  set: (change: Partial<WizardFields>) => void
  /** The check of the folder's own fields, held while another field is checked again. */
  repoCheck: ProjectCheck | null
  /** A check of the folder's fields is due or running: `repoCheck` is not theirs yet. */
  repoPending: boolean
  current: string | null
  branches: RepoBranches | null
  branchShown: boolean
  badBranch: boolean
  onBranchOpen: () => void
  onRecheck: () => void
}

/**
 * The wizard's "Repository" block (BTN-1093): how tasks work, then for git one field "Folder or repository address" the
 * service reads itself — an address is a clone, a repository's top the checkout already there, a folder without git a
 * new repository in it, a path not there one made, a bare name a new folder in Even Keel's projects folder — with one
 * line under it saying how it was read. A clone has its own folder line under the branch; a project without git only
 * the folder line. Git that does not start closes git, with the way to the setup's Git step.
 */
export function RepoStep({ state, fields, set, repoCheck, repoPending, current, branches, branchShown, badBranch, onBranchOpen, onRecheck }: RepoStepProps) {
  const ready = gitReadiness(state)
  const repo = repoCheck?.repo ?? null
  const refusal = repo?.notice ?? null
  const remoteRefused = isRemoteRefusal(refusal)
  const clone = cloneTyped(fields)
  const read = fields.git ? (repo?.read ?? null) : null
  // A clone's folder answers under its own line; everything else is the one field's answer.
  const folderRefusal = clone && read?.as === 'clone' && repo?.place !== undefined && !remoteRefused
  const branchLine = !branchShown && (
    <>
      {' · '}
      {t.wizard.mainBranch(fields.branch || current || 'main')}{' '}
      <button type="button" className="link-button" onClick={onBranchOpen}>
        [{t.wizard.changeBranch}]
      </button>
    </>
  )
  // A clone's field offers its remote's branches and says which one the clone takes, never a move of a checkout (BTN-1096).
  const remote = clone && !remoteRefused ? repo?.remoteBranches : undefined
  const branchRow = fields.git && branchShown && (
    <Row
      className="settings__field"
      label={t.settings.branch}
      hint={t.settings.branchHint}
      htmlFor="wizard-branch"
      control={<BranchField id="wizard-branch" value={fields.branch} repo={clone ? null : branches} remote={remote} placeholder={current ?? 'main'} invalid={badBranch} onChange={(branch) => set({ branch })} />}
    >
      <BranchMoveLine repo={clone ? null : branches} remote={remote} value={fields.branch} />
    </Row>
  )
  return (
    <>
      <Row
        className="settings__field project-add__pick"
        label={t.wizard.mode}
        control={
          <Segmented
            label={t.wizard.mode}
            options={[
              ['git', t.wizard.modeGit],
              ['plain', t.wizard.modePlain],
            ]}
            value={fields.git ? 'git' : 'plain'}
            blocked={ready.missing ? ['git'] : []}
            onChange={(mode) => set({ git: mode === 'git' })}
          />
        }
      >
        <span className="settings__hint">{t.wizard.modeHints[fields.git ? 'git' : 'plain']}</span>
        {ready.missing && (
          <span className="project-add__gate">
            <Status>{t.creation.gitMissing}</Status>
            <Link className="button button--small" to={stepPath('git')}>
              {t.creation.gitSetup}
            </Link>
          </span>
        )}
      </Row>
      {fields.git && (
        <div className="settings__field">
          <FieldHead label={t.creation.target} hint={t.creation.targetHint} htmlFor="wizard-target" />
          <input
            id="wizard-target"
            className="settings__text settings__text--mono"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={fields.target}
            placeholder={t.creation.targetPlaceholder(state.platform)}
            aria-invalid={(refusal !== null && !folderRefusal) || undefined}
            onChange={(event) => set({ target: event.target.value })}
          />
          {read !== null && (refusal === null || folderRefusal) && <ReadLine read={read} repo={repo!} current={current} branchLine={branchLine} />}
          {remoteRefused ? <RemoteRefusal refusal={refusal} /> : !folderRefusal && <TargetRefusal refusal={refusal} set={set} onRecheck={onRecheck} />}
          {refusal?.code === 'wizard.noCommits' && repo?.root != null && <MakeRepository repo={repo.root} branch={fields.branch.trim()} exists onMade={onRecheck} />}
        </div>
      )}
      {branchRow}
      {(!fields.git || clone) && <FolderLine state={state} fields={fields} set={set} repo={repo} pending={repoPending} hideRefusal={fields.git && !folderRefusal} />}
      {repoCheck?.trusted === false && <p className="settings__hint">{trustTexts().pending}</p>}
      {repoCheck?.trusted === true && <Status ok>{t.wizard.trusted}</Status>}
    </>
  )
}

/** How the one field was read, in one line with an icon (BTN-1093); a folder that holds files warns of the first commit under it. */
function ReadLine({ read, repo, current, branchLine }: { read: SourceRead; repo: ProjectCheck['repo']; current: string | null; branchLine: ReactNode }) {
  const reads = t.creation.reads
  const path = repo.root === null ? null : <bdi className="project-add__path">{repo.root}</bdi>
  const holds = read.as === 'here' && repo.place?.state === 'filled' ? repo.place.holds : undefined
  const line = (icon: ReactNode, words: ReactNode, tail: ReactNode) => (
    <p className="project-add__read">
      <span className="project-add__read-icon">{icon}</span>
      <span>
        {words}
        {tail}
      </span>
    </p>
  )
  switch (read.as) {
    case 'clone':
      // The remote answers before the place does: until then the line waits.
      if (repo.place === undefined) return null
      return line(<ClonesIcon />, reads.clone(read.host), current === null ? ` · ${reads.cloneEmpty}` : branchLine)
    case 'existing':
      return line(
        <BranchIcon />,
        reads.existing,
        <>
          {' · '}
          {read.remote === null ? (
            reads.noRemote
          ) : (
            <>
              {read.remote.name} <bdi className="project-add__path">{read.remote.url}</bdi>
            </>
          )}
          {branchLine}
        </>,
      )
    case 'here':
      return (
        <>
          {line(<PlusIcon />, reads.here, holds === undefined ? <>{` · ${reads.empty}`}{branchLine}</> : branchLine)}
          {holds !== undefined && <p className="project-add__open">{t.creation.firstCommit(holds.files, holds.bytes, holds.capped)}</p>}
        </>
      )
    case 'make':
    case 'name':
      return line(
        <PlusIcon />,
        reads[read.as],
        <>
          {path !== null && <> · {path}</>}
          {branchLine}
        </>,
      )
  }
}

/** A remote's refusal in one line under its field; git's own words behind a question mark, a command to run under it. */
function RemoteRefusal({ refusal }: { refusal: Notice }) {
  return (
    <Status>
      <RefusalWords refusal={refusal} />
    </Status>
  )
}

/**
 * The one field's refusal: a subfolder offers its repository's top; git without a name and e-mail "Set them", a dialog
 * over the wizard (BTN-1094) after whose save the field is checked again with all typed kept.
 */
function TargetRefusal({ refusal, set, onRecheck }: { refusal: Notice | null; set: (change: Partial<WizardFields>) => void; onRecheck: () => void }) {
  if (refusal === null) return null
  if (refusal.code === 'wizard.insideRepo') {
    const root = refusal.params.root
    return (
      <span className="project-add__gate">
        <Status>{say(refusal)}</Status>
        <button type="button" className="button button--small" onClick={() => set({ target: root })}>
          {t.creation.takeRoot}
        </button>
      </span>
    )
  }
  if (refusal.code === 'git.noIdentity') {
    return (
      <span className="project-add__gate">
        <Status>{say(refusal)}</Status>
        <NoticeFixButton project={null} notice={refusal} onFixed={onRecheck} />
      </span>
    )
  }
  return <Refusal refusal={refusal} />
}

function Refusal({ refusal }: { refusal: ProjectCheck['repo']['notice'] }) {
  if (refusal === null) return null
  const taken = refusal.code === 'wizard.repoTaken' || refusal.code === 'wizard.folderTaken'
  return (
    <Status>
      {say(refusal)}
      {taken && (
        <>
          {' '}
          <Link to={projectPath(refusal.params.project)}>{t.wizard.openProject}</Link>
        </>
      )}
    </Status>
  )
}

/**
 * The folder of a clone or a project without git: Even Keel's projects folder and a name in it, the suggested one while
 * it is blank, or a full path behind "another folder…"; under it what the folder is now.
 */
function FolderLine({
  state,
  fields,
  set,
  repo,
  pending,
  hideRefusal,
}: {
  state: EvenKeelState
  fields: WizardFields
  set: (change: Partial<WizardFields>) => void
  repo: ProjectCheck['repo'] | null
  pending: boolean
  hideRefusal: boolean
}) {
  const place = repo?.place
  const refusal = hideRefusal ? null : (repo?.notice ?? null)
  const hint = !fields.other ? t.creation.folderHint : !fields.git ? t.creation.folderOtherHintPlain : t.creation.folderOtherHint
  const typed = pathTyped(fields)
  const clone = cloneTyped(fields)
  // The projects folder stays in front of the name while a refused name has no place.
  const lastDir = useRef<string | null>(null)
  if (place?.dir != null) lastDir.current = place.dir
  // The address a clone's place was last answered for: erasing the name keeps the block while it is checked again.
  const address = fields.target.trim()
  const heard = useRef<string | null>(null)
  if (place !== undefined && clone) heard.current = address
  const view = folderView(fields, { answer: place !== undefined || refusal !== null, remoteHeard: heard.current === address, pending })
  if (!view.shown) return null
  const dir = typed ? null : (place?.dir ?? lastDir.current)
  const separator = dir !== null && !dir.includes('\\') ? '/' : state.platform === 'win32' ? '\\' : '/'
  return (
    <div className="settings__field">
      <FieldHead label={t.creation.folder} hint={hint} htmlFor="wizard-folder" />
      {typed ? (
        <input
          id="wizard-folder"
          className="settings__text settings__text--mono"
          autoComplete="off"
          spellCheck={false}
          value={fields.repo}
          placeholder={t.creation.folderOtherPlaceholder}
          aria-invalid={refusal !== null || undefined}
          onChange={(event) => set({ repo: event.target.value })}
        />
      ) : (
        <span className="project-add__folder">
          {dir !== null && (
            <span className="project-add__dir" title={dir}>
              <bdi dir="ltr">
                {dir}
                {separator}
              </bdi>
            </span>
          )}
          <input
            id="wizard-folder"
            className="settings__text settings__text--mono project-add__name"
            autoComplete="off"
            spellCheck={false}
            value={fields.folder}
            placeholder={place?.name ?? ''}
            aria-invalid={refusal !== null || undefined}
            onChange={(event) => set({ folder: event.target.value })}
          />
        </span>
      )}
      <button type="button" className="link-button project-add__other" onClick={() => set(typed ? { other: false } : { other: true })}>
        {typed ? t.creation.own : t.creation.other}
      </button>
      {view.note !== null && <span className="settings__hint">{view.note === 'checking' ? t.wizard.checking : t.creation.folderBlank(clone)}</span>}
      {place !== undefined && refusal === null && <PlaceState place={place} fields={fields} />}
      {place?.existing !== undefined && refusal === null && (
        <span className="project-add__gate">
          <span className="settings__hint">{t.creation.cloneThere(place.existing)}</span>
          <button type="button" className="button button--small" onClick={() => set({ target: place.existing!, other: false })}>
            {t.creation.takeIt}
          </button>
        </span>
      )}
      <Refusal refusal={refusal} />
    </div>
  )
}

function PlaceState({ place, fields }: { place: NonNullable<ProjectCheck['repo']['place']>; fields: WizardFields }) {
  if (place.state === 'filled' && fields.git && place.holds !== undefined) {
    return <p className="project-add__open">{t.creation.firstCommit(place.holds.files, place.holds.bytes, place.holds.capped)}</p>
  }
  return <Status ok>{t.creation.states[place.state]}</Status>
}
