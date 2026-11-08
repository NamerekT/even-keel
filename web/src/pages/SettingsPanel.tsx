import { useEffect, useRef, useState, type ReactNode } from 'react'
import './projectSettingsTabs.css'
import { useRepoBranches } from './BranchField.js'
import { GROUPS, keysOf, same, type GroupId } from './projectSettingsDraft.js'
import { BUILTIN } from '../../../src/builtin/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { ChainRules } from '../../../src/chain/rules.js'
import type { ConfigView, ProjectForm } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { offeredProviders } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { changed, sent, type Value } from './settingsDraft.js'
import { namedProviders } from './settingsRun.js'
import { GroupTabs, type RuleKey, rulesOf, SaveBar, unplaced, useFieldErrors } from './settingsParts.js'
import { newMilestones, ruleChoicesOf, sourceTasks } from './settingsRows.js'
import { useSourceMoves } from './SourceMoves.js'
import { useVocabularies } from './useVocabularies.js'
import { useModelCatalog } from './useModels.js'
import { useModelReset } from './modelReset.js'
import { formOf, profileOf, valuesOf } from './projectForm.js'
import { projectScope as scopeOf, sourceScope, useDraft, useTab } from './settingsStore.js'
import { invalidPending, TableDraft, validateTables } from './settingsTableDraft.js'
import { NoticeSettings } from './NoticeSettings.js'
import { panelFields } from './projectSettingsFields.js'
import { ProjectRepoTab } from './ProjectRepoTab.js'
import { ProjectTrackerTab } from './ProjectTrackerTab.js'
import { ProjectSessionsTab } from './ProjectSessionsTab.js'
import { ProjectCiTab } from './ProjectCiTab.js'
import './settings.css'

export { useSettingsDirty } from './projectSettingsDraft.js'

/** The project settings panel: the draft, the save and the frame; each tab draws its own rows. */
export function SettingsPanel({
  project,
  form,
  config,
  configError,
  tasks,
  onClose,
}: {
  project: string
  form: ProjectForm
  config: ConfigView
  configError: Notice | null
  /** The project's tasks: their statuses and labels are offered in the chain rules. */
  tasks: readonly Task[]
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { send, sending, failure } = useCommand()
  const { state } = useLive()
  const profile = profileOf(state, project, form.tracker)
  const profileRules: Partial<ChainRules> = profile?.rules ?? {}
  const saved = valuesOf(form, profileRules)
  const [current, setDraft] = useDraft(scopeOf(project), saved, same)
  const draft = current!
  const [open, setOpen] = useTab<GroupId>(scopeOf(project), 'repo')
  const vocabularies = useVocabularies(state?.projects.includes(project) === true ? [project] : [])
  const dirty = (id: GroupId) => changed(draft, keysOf(id), same).length > 0
  const outgoing = sent(draft, keysOf(open))
  const shared = config.shared
  const next = formOf(outgoing.form, form.name, shared)
  const base = formOf(outgoing.base, form.name, shared)
  const errorOf = useFieldErrors(project, [failure, configError], config)
  const fields = panelFields(draft, setDraft, saved, errorOf)
  const { text, editAll, revert } = fields
  const offered = offeredProviders(state?.account ?? null, namedProviders(text, [config.shared.provider, text('provider')], ['models', 'accounts']))
  // The model is offered from the account its row runs on: the project's own, else the shared one.
  const rowAccount = (provider: string) => text(`accounts.${provider}`) || (config.shared.accounts[provider] ?? '')
  const models = useModelCatalog(offered.map(rowAccount))
  const drift = state?.branchDrift[project]
  const branches = useRepoBranches(project, form.branch, drift)

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useModelReset(
    offered.map((provider) => ({ provider, choice: text(`accounts.${provider}`), account: rowAccount(provider), model: text(`models.${provider}`) })),
    models,
    (providers) => editAll(providers.map((provider) => [`models.${provider}`, ''])),
  )
  const chain = rulesOf(draft.edit as Record<RuleKey, Value>)
  // The rules inherit from the profile of the tracker the draft has: a tracker changed and not saved yet brings its own.
  const ruleProfile = profileOf(state, project, text('tracker'))
  // The main tracker's tasks only: a feed's are offered in its own window (BTN-553).
  const mainTasks = sourceTasks(tasks, config.feeds[project] ?? [], null)
  const ruleChoices = ruleChoicesOf(mainTasks, vocabularies)
  const [configuring, setConfiguring] = useState(false)
  // A fix button may ask for the window open on a tab of its own ("Milestone order", BTN-792).
  const [sourceTab, openSourceTab] = useTab<string>(sourceScope(project), '')
  const moves = useSourceMoves({ state, project, feed: null, kind: text('tracker'), profile: ruleProfile, rules: chain, saved: form.moves })
  const onBuiltin = text('tracker') === BUILTIN
  const save = async () => {
    if (next === undefined || base === undefined) return false
    // The built-in tracker gets the milestones the rules name first: "Add a milestone" creates one (BTN-769).
    if (form.tracker === BUILTIN && onBuiltin)
      for (const name of newMilestones(next.chain, ruleChoices.milestones)) if (!(await send('builtin/milestone', { project, name }))) return false
    return send('project/settings', { project, ...next, base })
  }
  const leftover = unplaced(project, failure, config)

  const groups: Record<GroupId, () => ReactNode> = {
    repo: () => <ProjectRepoTab fields={fields} project={project} form={form} state={state} config={config} branches={branches} drift={drift} />,
    tracker: () => (
      <ProjectTrackerTab
        fields={fields}
        project={project}
        form={form}
        state={state}
        config={config}
        tasks={tasks}
        mainTasks={mainTasks}
        ruleProfile={ruleProfile}
        chain={chain}
        ruleChoices={ruleChoices}
        vocabularies={vocabularies}
        moves={moves}
        configuring={configuring}
        setConfiguring={setConfiguring}
        sourceTab={sourceTab}
        openSourceTab={openSourceTab}
        canSave={!sending && next !== undefined}
        leftover={leftover}
        save={save}
      />
    ),
    sessions: () => <ProjectSessionsTab fields={fields} project={project} form={form} state={state} shared={shared} offered={offered} rowAccount={rowAccount} models={models} />,
    ci: () => <ProjectCiTab fields={fields} project={project} state={state} shared={shared} />,
    notices: () => <NoticeSettings project={project} />,
  }

  return (
    <aside className="panel settings" aria-label={t.settings.title}>
      <header className="panel__head settings__head">
        <GroupTabs groups={GROUPS.map(({ id }) => ({ id, title: t.settings.groups[id] }))} open={open} dirty={dirty} onOpen={setOpen} />
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      <TableDraft value={{ draft, setDraft }}>
      <form
        className="settings__form"
        role="tabpanel"
        aria-labelledby={`settings-tab-${open}`}
        onSubmitCapture={(event) => {
          const invalid = invalidPending(draft, keysOf(open))
          validateTables(event, invalid)
          if (invalid.length > 0) setConfiguring(true)
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {groups[open]()}
        {leftover !== null && <p className="notice notice--error">{say(leftover)}</p>}
        <SaveBar shown={dirty(open)} canSave={!sending && next !== undefined} onRevert={() => revert(keysOf(open))} />
      </form>
      </TableDraft>
    </aside>
  )
}
