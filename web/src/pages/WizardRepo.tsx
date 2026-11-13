import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { notice, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectCheck, ProjectDraft, RepoBranches, RepoSource } from '../../../src/state.js'
import { examplePaths } from '../examplePaths.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { projectPath } from '../state.js'
import { Segmented } from '../stats/common.js'
import { BranchField, BranchMoveLine } from './BranchField.js'
import { NoticeFixButton } from './FixButtons.js'
import { folderView, pathTyped, type WizardFields } from './projectWizard.js'
import { isRemoteRefusal, remoteRefusal } from './remoteRefusal.js'
import { FieldHead, HelpTip, Row } from './settingsParts.js'
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
          {say(failure)} <NoticeFixButton project={null} notice={failure} />
        </p>
      )}
    </div>
  )
}

/** What git on the service's machine allows (BTN-1048): no git — no repository; no name and e-mail — no clone or new one. */
export function gitReadiness(state: EvenKeelState): { missing: boolean; anonymous: boolean } {
  const git = state.git
  return { missing: git?.version === null, anonymous: git !== undefined && git.version !== null && (git.name === null || git.email === null) }
}

interface RepoStepProps {
  state: EvenKeelState
  fields: WizardFields
  set: (change: Partial<WizardFields>) => void
  draft: ProjectDraft | undefined
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
 * The wizard's "Repository" block (BTN-1048): how tasks work, then for git the source — a clone from a remote, a new
 * repository, or a checkout already there — and the folder: a name in Even Keel's projects folder by default, a full
 * path behind "another folder…". Git that does not start closes git; git without a name and e-mail closes the clone
 * and the new repository, each with the way to the setup's Git step.
 */
export function RepoStep({ state, fields, set, draft, repoCheck, repoPending, current, branches, branchShown, badBranch, onBranchOpen, onRecheck }: RepoStepProps) {
  const ready = gitReadiness(state)
  const repo = repoCheck?.repo ?? null
  const refusal = repo?.notice ?? null
  const remoteRefused = isRemoteRefusal(refusal)
  const clone = fields.git && fields.source === 'clone'
  const existing = fields.git && fields.source === 'existing'
  const found = repo !== null && repo.root !== null && refusal === null ? repo.root : null
  const branchLine = !branchShown && (
    <>
      {' · '}
      {t.wizard.mainBranch(fields.branch || current || 'main')}{' '}
      <button type="button" className="link-button" onClick={onBranchOpen}>
        [{t.wizard.changeBranch}]
      </button>
    </>
  )
  // Opened where its "[change]" was: under the remote for a clone, under the path or the folder otherwise.
  const branchRow = fields.git && branchShown && (
    <Row
      className="settings__field"
      label={t.settings.branch}
      hint={t.settings.branchHint}
      htmlFor="wizard-branch"
      control={<BranchField id="wizard-branch" value={fields.branch} repo={branches} placeholder={current ?? 'main'} invalid={badBranch} onChange={(branch) => set({ branch })} />}
    >
      <BranchMoveLine repo={branches} value={fields.branch} />
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
        <Row
          className="settings__field project-add__pick"
          label={t.creation.source}
          control={
            <Segmented<RepoSource>
              label={t.creation.source}
              options={[
                ['clone', t.creation.sources.clone],
                ['new', t.creation.sources.new],
                ['existing', t.creation.sources.existing],
              ]}
              value={fields.source}
              blocked={ready.anonymous ? ['clone', 'new'] : []}
              onChange={(source) => set({ source, other: false })}
            />
          }
        >
          <span className="settings__hint">{t.creation.sourceHints[fields.source]}</span>
          {ready.anonymous && (
            <span className="project-add__gate">
              <Status>{t.creation.noIdentity}</Status>
              <NoticeFixButton project={null} notice={notice('git.noIdentity', {})} />
            </span>
          )}
        </Row>
      )}
      {clone && (
        <div className="settings__field">
          <FieldHead label={t.creation.remote} hint={t.creation.remoteHint} htmlFor="wizard-remote" />
          <input
            id="wizard-remote"
            className="settings__text settings__text--mono"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={fields.remote}
            placeholder={t.creation.remotePlaceholder}
            aria-invalid={remoteRefused || undefined}
            onChange={(event) => set({ remote: event.target.value })}
          />
          {remoteRefused && <RemoteRefusal refusal={refusal} />}
          {repo?.place !== undefined && !remoteRefused && (
            <Status ok>
              {t.creation.remoteRead(current)}
              {current !== null && branchLine}
            </Status>
          )}
        </div>
      )}
      {clone && branchRow}
      {existing ? (
        <div className="settings__field">
          <FieldHead label={t.wizard.path} hint={t.wizard.repoHint} htmlFor="wizard-repo" />
          <input
            id="wizard-repo"
            className="settings__text settings__text--mono"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={fields.repo}
            placeholder={examplePaths(state.platform).repo}
            aria-invalid={refusal !== null}
            onChange={(event) => set({ repo: event.target.value })}
          />
          {found !== null && (
            <Status ok>
              {t.wizard.repoFound(found)}
              {branchLine}
            </Status>
          )}
          <Refusal refusal={refusal} />
          {draft !== undefined && (refusal?.code === 'wizard.notRepo' || refusal?.code === 'wizard.noCommits') && (
            <MakeRepository repo={draft.repo} branch={draft.branch} exists={refusal.code === 'wizard.noCommits'} onMade={onRecheck} />
          )}
        </div>
      ) : (
        <FolderLine state={state} fields={fields} set={set} repo={repo} pending={repoPending} hideRefusal={remoteRefused} branchLine={fields.git && fields.source === 'new' && found !== null ? branchLine : null} />
      )}
      {!clone && branchRow}
      {repoCheck?.trusted === false && <p className="settings__hint">{trustTexts().pending}</p>}
      {repoCheck?.trusted === true && <Status ok>{t.wizard.trusted}</Status>}
    </>
  )
}

/** A remote's refusal in one line under its field; git's own words behind a question mark. */
function RemoteRefusal({ refusal }: { refusal: Notice }) {
  const { shown, detail } = remoteRefusal(refusal)
  return (
    <Status>
      {say(shown)}
      {detail !== null && (
        <>
          {' '}
          <HelpTip text={detail} />
        </>
      )}{' '}
      <NoticeFixButton project={null} notice={refusal} />
    </Status>
  )
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
 * The folder of a clone, a new repository or a project without git: Even Keel's projects folder and a name in it, the
 * suggested one while it is blank, or a full path behind "another folder…"; under it what the folder is now.
 */
function FolderLine({
  state,
  fields,
  set,
  repo,
  pending,
  hideRefusal,
  branchLine,
}: {
  state: EvenKeelState
  fields: WizardFields
  set: (change: Partial<WizardFields>) => void
  repo: ProjectCheck['repo'] | null
  pending: boolean
  hideRefusal: boolean
  branchLine: ReactNode
}) {
  const place = repo?.place
  const refusal = hideRefusal ? null : (repo?.notice ?? null)
  const hint = !fields.other ? t.creation.folderHint : !fields.git ? t.creation.folderOtherHintPlain : fields.source === 'new' ? t.creation.folderOtherHintNew : t.creation.folderOtherHint
  const typed = pathTyped(fields)
  // The projects folder stays in front of the name while a refused name has no place.
  const lastDir = useRef<string | null>(null)
  if (place?.dir != null) lastDir.current = place.dir
  // The remote a clone's place was last answered for: erasing the name keeps the block while it is checked again.
  const remote = fields.remote.trim()
  const heard = useRef<string | null>(null)
  if (place !== undefined && fields.git && fields.source === 'clone') heard.current = remote
  const view = folderView(fields, { answer: place !== undefined || refusal !== null, remoteHeard: heard.current === remote, pending })
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
      {view.note !== null && <span className="settings__hint">{view.note === 'checking' ? t.wizard.checking : t.creation.folderBlank(fields.git && fields.source === 'clone')}</span>}
      {place !== undefined && refusal === null && <PlaceState place={place} fields={fields} branchLine={branchLine} />}
      {place?.existing !== undefined && refusal === null && (
        <span className="project-add__gate">
          <span className="settings__hint">{t.creation.cloneThere(place.existing)}</span>
          <button type="button" className="button button--small" onClick={() => set({ source: 'existing', repo: place.existing!, other: false })}>
            {t.creation.takeIt}
          </button>
        </span>
      )}
      <Refusal refusal={refusal} />
    </div>
  )
}

function PlaceState({ place, fields, branchLine }: { place: NonNullable<ProjectCheck['repo']['place']>; fields: WizardFields; branchLine: ReactNode }) {
  if (place.state === 'filled' && fields.git && place.holds !== undefined) {
    return <p className="project-add__open">{t.creation.firstCommit(place.holds.files, place.holds.bytes, place.holds.capped)}</p>
  }
  return (
    <Status ok>
      {t.creation.states[place.state]}
      {branchLine}
    </Status>
  )
}
