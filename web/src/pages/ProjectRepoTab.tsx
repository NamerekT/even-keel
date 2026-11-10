import type { BranchDrift, ConfigView, EvenKeelState, ProjectForm, RepoBranches } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { PROJECT_SLOTS, projectLabel } from '../state.js'
import { CommandBlock } from '../ui/blocks.js'
import { seriesStyle } from '../ui/series.js'
import { BadgeButton } from './BadgeButton.js'
import { BranchDriftBand, BranchField, BranchMoveLine } from './BranchField.js'
import { GitOffSection, GitOnSection } from './GitSwitch.js'
import { ProjectRemove } from './ProjectRemove.js'
import type { PanelFields } from './projectSettingsFields.js'
import { ErrorStrip, FieldHead, fieldId, Row, Section, SwitchField, wholeOf } from './settingsParts.js'

/** The "Repository" tab of the project settings panel. */
export function ProjectRepoTab({
  fields,
  project,
  form,
  state,
  config,
  branches,
  drift,
}: {
  fields: PanelFields
  project: string
  form: ProjectForm
  state: EvenKeelState | null
  config: ConfigView
  branches: RepoBranches | null
  drift: BranchDrift | undefined
}) {
  const { text, on, edit, marks, errorOf, notes, input, pick, number } = fields
  // A release project merges into a main one of its own repository, never into another release project. Until the
  // remotes are read, every main project is offered: the save checks it.
  const kin = state?.sameRepository[project]
  const mainProjects = Object.entries(config.projects).flatMap(([key, each]) =>
    key !== project && each.mergeInto === null && (kin === undefined || kin.includes(key)) ? [key] : [],
  )
  if (!form.git) return <PlainRepoTab fields={fields} project={project} form={form} state={state} />
  return (
    <>
      <Section title={t.settings.sections.repository}>
        <div className={marks.box('repo')}>
          <FieldHead label={t.settings.repo} hint={t.settings.repoHint} htmlFor={fieldId('repo')} mark={marks.note('repo')} />
          <ErrorStrip error={errorOf('repo')} wide>
            <input
              id={fieldId('repo')}
              className="settings__text settings__text--mono"
              autoComplete="off"
              spellCheck={false}
              value={text('repo')}
              aria-invalid={errorOf('repo') !== null}
              onChange={(event) => edit('repo', event.target.value)}
            />
          </ErrorStrip>
        </div>
        <Row
          className={marks.box('branch')}
          label={t.settings.branch}
          hint={t.settings.branchHint}
          htmlFor={fieldId('branch')}
          mark={marks.note('branch')}
          control={
            <BranchField id={fieldId('branch')} value={text('branch')} repo={branches} placeholder="main" invalid={errorOf('branch') !== null} onChange={(value) => edit('branch', value)} />
          }
          error={errorOf('branch')}
        >
          {text('branch').trim() !== form.branch && <BranchMoveLine repo={branches} value={text('branch')} />}
          {drift !== undefined && <BranchDriftBand project={project} drift={drift} />}
        </Row>
        {input('changelog', t.settings.changelog, t.settings.changelogHint, 'CHANGELOG.md')}
        <SwitchField
          className={marks.box('testProject')}
          label={t.settings.testProject}
          hint={t.settings.testProjectHint}
          checked={on('testProject')}
          mark={marks.note('testProject')}
          onChange={(checked) => edit('testProject', checked)}
        >
          {notes('testProject')}
        </SwitchField>
        <Row
          className={marks.box('slot')}
          label={t.settings.slot}
          hint={t.settings.slotHint}
          htmlFor={fieldId('slot')}
          mark={marks.note('slot')}
          control={number('slot', text('slot'), wholeOf(text('slot'), 0) === undefined || errorOf('slot') !== null, (value) => edit('slot', value))}
          error={errorOf('slot')}
        />
        {pick('mergeInto', t.settings.mergeInto, t.settings.mergeIntoHint, [
          { value: '', label: t.settings.mergeIntoNone },
          ...mainProjects.map((key) => ({ value: key, label: projectLabel(state, key) })),
          ...(text('mergeInto') !== '' && !mainProjects.includes(text('mergeInto'))
            ? [{ value: text('mergeInto'), label: projectLabel(state, text('mergeInto')) }]
            : []),
        ])}
        {text('mergeInto') !== '' && (
          <SwitchField
            className={marks.box('carryAgent')}
            label={t.settings.carryAgent}
            hint={t.settings.carryAgentHint}
            checked={on('carryAgent')}
            mark={marks.note('carryAgent')}
            onChange={(checked) => edit('carryAgent', checked)}
          >
            {notes('carryAgent')}
          </SwitchField>
        )}
        <ColorField fields={fields} />
      </Section>
      <BadgeButton project={project} badge={form.badge} />
      <GitOffSection state={state} project={project} />
      <ProjectRemove project={project} />
    </>
  )
}

/**
 * The tab of a project without git: the mode and the folder are read, not edited — "Turn on git" switches the mode
 * (BTN-884) — and the slots are shown off with the reason, so that nothing is ignored in silence.
 */
function PlainRepoTab({ fields, project, form, state }: { fields: PanelFields; project: string; form: ProjectForm; state: EvenKeelState | null }) {
  const { on, edit, marks, notes } = fields
  const text = t.settings.plain
  return (
    <>
      <Section title={text.section}>
        <Row className="settings__field" label={text.mode} hint={text.modeHint} control={<span>{text.modeValue}</span>} />
        <div className="settings__field">
          <FieldHead label={text.folder} hint={text.folderHint} />
          <CommandBlock command={form.repo} copyLabel={t.common.copyPath} />
        </div>
        <SwitchField
          className={marks.box('testProject')}
          label={t.settings.testProject}
          hint={t.settings.testProjectHint}
          checked={on('testProject')}
          mark={marks.note('testProject')}
          onChange={(checked) => edit('testProject', checked)}
        >
          {notes('testProject')}
        </SwitchField>
        <Row className="settings__field" label={t.settings.slot} hint={text.slotHint} control={<span>{text.slotValue}</span>} />
        <ColorField fields={fields} />
      </Section>
      <GitOnSection state={state} project={project} />
      <BadgeButton project={project} badge={form.badge} />
      <ProjectRemove project={project} />
    </>
  )
}

function ColorField({ fields }: { fields: PanelFields }) {
  const { text, edit, marks, notes } = fields
  return (
    <div className={marks.box('color')}>
      <FieldHead label={t.settings.color} hint={t.settings.colorHint} mark={marks.note('color')} />
      <div className="settings__colors" role="radiogroup" aria-label={t.settings.color}>
        {Array.from({ length: PROJECT_SLOTS }, (_, index) => String(index + 1)).map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={text('color') === color}
            aria-label={t.settings.colorSlot(Number(color))}
            className={text('color') === color ? 'settings__color settings__color--on' : 'settings__color'}
            style={seriesStyle(Number(color))}
            onClick={() => edit('color', color)}
          />
        ))}
      </div>
      {notes('color')}
    </div>
  )
}
