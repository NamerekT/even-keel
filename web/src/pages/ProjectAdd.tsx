import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectCheck, ProjectDraft } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { projectPath } from '../state.js'
import { Segmented } from '../stats/common.js'
import { Select } from '../ui/Select.js'
import { agentCheck, AgentReady } from './AgentReady.js'
import {
  draftOfFields,
  EMPTY_FIELDS,
  keyOfTyped,
  keyTyped,
  missingOf,
  readyToAdd,
  shapeOf,
  stepChecks,
  suggestOfRepo,
  switchProfile,
  trustCommand,
  trustCommandAs,
  typedIn,
  WIZARD_STEPS,
  type Missing,
  type WizardFields,
  type WizardStepId,
} from './projectWizard.js'
import { ProjectSummary } from './ProjectSummary.js'
import { FieldHead, Row, Section } from './settingsParts.js'
import { ruleChoicesOf } from './settingsRows.js'
import { providerOptions } from './settingsRun.js'
import { ListTable } from './settingsTable.js'
import { setupLine } from './Setup.js'
import { stepPath } from './setupSteps.js'
import { Status } from './TrackerFields.js'
import { checkMarks } from './wizard.js'
import { StepDot, WizardFoot, WizardFrame } from './WizardFrame.js'
import { TrackerStep } from './WizardTracker.js'
import './settings.css'
import './projectAdd.css'

const CHECK_DELAY_MS = 600

/** The fields typed, kept while the page is left and come back to (BTN-310); a project added clears them. */
let kept: WizardFields | null = null

interface Checked {
  draft: ProjectDraft
  result: ProjectCheck
}

/**
 * Adding a project: the agent, the repository, the tracker's profile and project, the key and the name where the
 * tracker leaves them free, and the tasks' folders, each a card whose dot says what the service's check of it answered
 * as it is typed; "Add" writes the project once the repository, the entry and the tracker pass, and says what is
 * missing while it cannot. Without a project yet it is the first run's last step, under the first run's line (BTN-344).
 */
export function ProjectAddPage({ state }: { state: EvenKeelState }) {
  const { checkProject } = useLive()
  const navigate = useNavigate()
  const { send, sending, failure } = useCommand()
  const [fields, setFields] = useState<WizardFields>(() => kept ?? firstFields(state))
  const [checked, setChecked] = useState<Checked | null>(null)
  const [checkFailure, setCheckFailure] = useState<Notice | null>(null)
  const [checking, setChecking] = useState(false)
  const [round, setRound] = useState(0)
  const [added, setAdded] = useState<{ key: string; before: string[] } | null>(null)
  const [branchOpen, setBranchOpen] = useState(false)
  const [milestonesOpen, setMilestonesOpen] = useState(false)
  const choice = state.config.trackers.find((each) => each.name === fields.tracker)
  const shape = shapeOf(choice)
  const profile = state.profiles.profiles.find((each) => each.id === fields.profile)
  const draft = draftOfFields(fields, profile?.isDefault === true)
  const draftText = JSON.stringify(draft ?? null)
  const fresh = checked !== null && JSON.stringify(checked.draft) === draftText
  const check = fresh ? checked.result : null
  // The folder's lines depend on the folder and the branch only: they hold while another field is checked again.
  const repoCheck =
    checked !== null && draft !== undefined && checked.draft.repo === draft.repo && checked.draft.branch === draft.branch
      ? checked.result
      : null
  const set = (change: Partial<WizardFields>) => setFields((before) => ({ ...before, ...change }))
  const shared = state.config.shared.provider
  const agent = fields.provider || shared

  useEffect(() => {
    kept = fields
  }, [fields])

  useEffect(() => {
    if (draft === undefined || draft.repo === '') return
    let live = true
    const timer = setTimeout(() => {
      setChecking(true)
      checkProject(draft).then(
        (result) => {
          if (!live) return
          setChecked({ draft, result })
          setCheckFailure(null)
        },
        (error: unknown) => live && setCheckFailure(noticeOf(error)),
      ).finally(() => live && setChecking(false))
    }, CHECK_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // The draft's text stands for the draft: a new object of the same fields asks nothing again.
  }, [draftText, round])

  // Back from the terminal where the trust was given: ask again, once per return and not on a timer (the check reaches the tracker too).
  const untrusted = repoCheck?.trusted === false
  useEffect(() => {
    if (!untrusted) return
    const back = () => {
      if (document.visibilityState === 'visible') setRound((count) => count + 1)
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    }
  }, [untrusted])

  // A repository found: its current branch, and what its remotes and its name suggest for the fields still blank.
  const repo = checked?.result.repo
  const root = repo?.root ?? null
  const current = repo?.current ?? null
  const suggested = repo?.suggested ?? null
  useEffect(() => {
    setFields((before) => suggestOfRepo(before, shape, { root, current, suggested }))
  }, [root, current, suggested, shape])

  // A branch the repository lacks opens the field, and it stays open while the branch is typed again.
  const noBranch = repoCheck?.repo.notice?.code === 'wizard.noBranch'
  useEffect(() => {
    if (noBranch) setBranchOpen(true)
  }, [noBranch])

  // A tracker project another project has opens the milestones, and they stay open while they are typed (BTN-306).
  const trackerShared = check?.entry?.code === 'wizard.trackerShared'
  useEffect(() => {
    if (trackerShared) setMilestonesOpen(true)
  }, [trackerShared])

  useEffect(() => {
    if (added === null) return
    // The new project is the one of the key that was not there before: another project may have the key (BTN-271).
    const project = state.projects.find((each) => !added.before.includes(each) && state.projectKeys[each] === added.key)
    if (project !== undefined) void navigate(projectPath(project))
  }, [added, state, navigate])

  const add = async () => {
    if (draft === undefined || !readyToAdd(check)) return
    const before = state.projects
    if (!(await send('project/add', { ...draft }))) return
    kept = null
    setAdded({ key: draft.key.trim(), before })
  }

  const ready = readyToAdd(check)
  const missing = ready ? null : missingOf(fields, shape, check)
  const branchShown = branchOpen || noBranch || (root !== null && current === null)
  const checks = stepChecks(fields, shape, check, repoCheck, agentCheck(state, agent))
  const marks = checkMarks(WIZARD_STEPS.map((step) => checks[step]))
  const dot = (step: WizardStepId) => {
    const mark = marks[WIZARD_STEPS.indexOf(step)]!
    return <StepDot mark={mark} label={t.wizard.marks[mark]} />
  }
  const first = state.projects.length === 0

  return (
    <div className="page project-add">
      <WizardFrame
        title={first ? t.setup.title : t.wizard.title}
        lead={first ? t.setup.lead : t.wizard.hint}
        steps={first ? { label: t.setup.stepsLabel, list: setupLine(state), current: 'project' } : undefined}
        className="project-add__frame"
      >
        {first && <p className="project-add__lead">{t.wizard.hint}</p>}
        <div className="settings__form project-add__steps">
          <Section title={t.wizard.stepAgent} mark={dot('agent')} className="project-add__step">
            <Row
              className="settings__field"
              label={t.wizard.agent}
              hint={t.wizard.agentHint}
              htmlFor="wizard-agent"
              control={
                <Select
                  id="wizard-agent"
                  className="settings__text"
                  value={agent}
                  options={providerOptions().map((option) => (option.value === shared ? { ...option, label: t.wizard.sharedAgent(option.label) } : option))}
                  onChange={(value) => set({ provider: value === shared ? '' : value })}
                />
              }
            >
              <AgentReady state={state} provider={agent} />
            </Row>
          </Section>
          <Section title={t.wizard.stepRepo} mark={dot('repo')} className="project-add__step">
            <div className="settings__field">
              <FieldHead label={t.wizard.path} hint={t.wizard.repoHint} htmlFor="wizard-repo" />
              <input
                id="wizard-repo"
                className="settings__text settings__text--mono"
                spellCheck={false}
                autoFocus
                value={fields.repo}
                placeholder={t.wizard.repoPlaceholder}
                aria-invalid={repoCheck?.repo.notice != null}
                onChange={(event) => set({ repo: event.target.value })}
              />
              {repoCheck !== null && repoCheck.repo.root !== null && repoCheck.repo.notice === null && (
                <Status ok>
                  {t.wizard.repoFound(repoCheck.repo.root)}
                  {!branchShown && (
                    <>
                      {' · '}
                      {t.wizard.mainBranch(fields.branch || current || 'main')}{' '}
                      <button type="button" className="link-button" onClick={() => setBranchOpen(true)}>
                        [{t.wizard.changeBranch}]
                      </button>
                    </>
                  )}
                </Status>
              )}
              {repoCheck?.repo.notice != null && (
                <Status>
                  {say(repoCheck.repo.notice)}
                  {repoCheck.repo.notice.code === 'wizard.repoTaken' && (
                    <>
                      {' '}
                      <Link to={projectPath(repoCheck.repo.notice.params.project)}>{t.wizard.openProject}</Link>
                    </>
                  )}
                </Status>
              )}
            </div>
            {branchShown && (
              <Row
                className="settings__field"
                label={t.settings.branch}
                hint={t.settings.branchHint}
                htmlFor="wizard-branch"
                control={
                  <input
                    id="wizard-branch"
                    className="settings__text settings__text--mono"
                    spellCheck={false}
                    value={fields.branch}
                    placeholder={current ?? 'main'}
                    onChange={(event) => set({ branch: event.target.value })}
                  />
                }
              />
            )}
            {repoCheck?.trusted === false && repoCheck.repo.root !== null && (
              <div className="notice notice--warn project-add__trust">
                <p>{t.wizard.untrusted}</p>
                <TrustCommand command={trustCommand(repoCheck.repo.root, repoCheck.platform)} />
                <p>{t.wizard.trustUser(repoCheck.user)}</p>
                <TrustCommand command={trustCommandAs(repoCheck.repo.root, repoCheck.platform, repoCheck.user)} />
              </div>
            )}
            {repoCheck?.trusted === true && <Status ok>{t.wizard.trusted}</Status>}
          </Section>
          <Section title={t.wizard.stepTracker} mark={dot('tracker')} className="project-add__step">
            <TrackerStep state={state} fields={fields} shape={shape} check={check} onChange={setFields} />
          </Section>
          <Section title={t.wizard.stepProject} mark={dot('project')} className="project-add__step">
            {keyTyped(shape) && (
              <Row
                className="settings__field"
                label={shape === 'place' ? t.wizard.prefix : t.wizard.ownKey}
                hint={shape === 'place' ? t.wizard.prefixHint : t.wizard.ownKeyHint}
                htmlFor="wizard-key"
                control={
                  <input
                    id="wizard-key"
                    className="settings__text settings__text--mono project-add__key"
                    spellCheck={false}
                    maxLength={5}
                    value={fields.key}
                    placeholder="ABC"
                    aria-invalid={check?.entry != null}
                    onChange={(event) => setFields((before) => typedIn(before, 'key', keyOfTyped(event.target.value)))}
                  />
                }
              >
                {check?.entry != null && fields.key.trim() !== '' && !trackerShared && <Status>{say(check.entry)}</Status>}
              </Row>
            )}
            <Row
              className="settings__field"
              label={t.wizard.name}
              hint={t.wizard.nameHint}
              htmlFor="wizard-name"
              control={
                <input
                  id="wizard-name"
                  className="settings__text"
                  value={fields.name}
                  placeholder={fields.key || t.wizard.namePlaceholder}
                  onChange={(event) => setFields((before) => typedIn(before, 'name', event.target.value))}
                />
              }
            />
            {(milestonesOpen || trackerShared || fields.milestones.trim() !== '') && (
              <div className="settings__field">
                <FieldHead label={t.settings.rule.requiredMilestones} hint={t.wizard.milestonesHint} />
                <ListTable
                  label={t.settings.rule.requiredMilestones}
                  value={fields.milestones}
                  add={t.settings.ruleAdd.requiredMilestones}
                  empty={t.settings.rulePlaceholder.requiredMilestones}
                  suggest={ruleChoicesOf(state.tasks).milestones}
                  onChange={(milestones) => set({ milestones })}
                />
                {trackerShared && <Status>{say(check.entry!)}</Status>}
                {check !== null && check.yields.length > 0 && <Status ok>{t.wizard.yields(check.yields.join(', '))}</Status>}
              </div>
            )}
          </Section>
          <Section title={t.wizard.stepPlace} mark={dot('place')} className="project-add__step">
            <Row
              className="settings__field project-add__pick"
              label={t.wizard.place}
              control={
                <Segmented
                  label={t.wizard.place}
                  options={[
                    ['worktree', t.wizard.placeWorktree],
                    ['slots', t.wizard.placeSlots],
                  ]}
                  value={fields.place}
                  onChange={(place) => set({ place })}
                />
              }
            >
              <span className="settings__hint">{t.wizard.placeHints[fields.place]}</span>
            </Row>
            {fields.place === 'slots' && (
              <Row
                className="settings__field"
                label={t.wizard.placeCount}
                htmlFor="wizard-slots"
                control={
                  <input
                    id="wizard-slots"
                    className="settings__text"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={fields.slots}
                    aria-invalid={draft === undefined}
                    onChange={(event) => set({ slots: event.target.value })}
                  />
                }
              />
            )}
          </Section>
        </div>
        <ProjectSummary state={state} fields={fields} shape={shape} draft={draft} root={root} current={current} />
        {checkFailure !== null && <p className="notice notice--error">{say(checkFailure)}</p>}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
        <WizardFoot
          back={first ? { to: stepPath('stats'), label: t.setup.back } : { to: '/', label: t.wizard.back }}
          next={{ label: t.wizard.add, onNext: () => void add(), disabled: sending || added !== null || !ready }}
          note={
            <span className="project-add__note">
              {checking || missing === 'checking' ? (
                <span className="settings__hint">{t.wizard.checking}</span>
              ) : (
                missing !== null && <span className="settings__hint">{missingText(missing, fields, state)}</span>
              )}
              {draft !== undefined && draft.repo !== '' && (
                <button type="button" className="wizard__skip" disabled={checking} onClick={() => setRound((count) => count + 1)}>
                  {t.wizard.checkAgain}
                </button>
              )}
            </span>
          }
        />
      </WizardFrame>
    </div>
  )
}

/** The only tracker profile is chosen at once; with several the user picks. */
function firstFields(state: EvenKeelState): WizardFields {
  const trackers = new Set(state.profiles.kinds.filter((kind) => kind.tracker).map((kind) => kind.kind))
  const own = state.profiles.profiles.filter((profile) => trackers.has(profile.kind))
  return own.length === 1 ? switchProfile(EMPTY_FIELDS, own[0]!) : EMPTY_FIELDS
}

function missingText(missing: Exclude<Missing, 'checking'>, fields: WizardFields, state: EvenKeelState): string {
  const choice = state.config.trackers.find((each) => each.name === fields.tracker)
  const title = choice?.title ?? fields.tracker
  if (missing === 'project' && shapeOf(choice) === 'within') return t.wizard.missing.field(t.wizard.team)
  if (missing === 'place' || missing === 'project') return t.wizard.missing.field(t.settings.trackerProject(fields.tracker, title))
  if (missing === 'key') return t.wizard.missing.field(t.wizard.prefix)
  return t.wizard.missing[missing]
}

/** The command as selectable text; the copy button only where the page has the clipboard (plain HTTP from another host has none). */
function TrustCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined
  const copy = () => {
    navigator.clipboard.writeText(command).then(
      () => setCopied(true),
      () => undefined,
    )
  }
  return (
    <div className="project-add__command">
      <code className="settings__text--mono">{command}</code>
      {canCopy && (
        <button type="button" className="button" onClick={copy}>
          {copied ? t.wizard.commandCopied : t.wizard.copyCommand}
        </button>
      )}
    </div>
  )
}
