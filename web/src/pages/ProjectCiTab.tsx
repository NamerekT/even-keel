import { Fragment } from 'react'
import { CI_KINDS, type CiKind } from '../../../src/ci/model.js'
import { FORGES } from '../../../src/notice/en.js'
import type { EvenKeelState, SharedForm } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { AddPullProfile, PullHint } from './PullButtons.js'
import { remoteKey, switchOf } from './projectForm.js'
import type { PanelFields } from './projectSettingsFields.js'
import { remoteChoices } from './remoteProfiles.js'
import type { Value } from './settingsDraft.js'
import { FieldHead, fieldId, FieldNote, minutesOf, Row, Section, shown, SwitchField } from './settingsParts.js'

/** The "CI" tab of the project settings panel: the guard of the main branch and pull requests. */
export function ProjectCiTab({ fields, project, state, shared }: { fields: PanelFields; project: string; state: EvenKeelState | null; shared: SharedForm }) {
  const { draft, saved, text, on, edit, marks, errorOf, notes, pick, inheritedSwitch, lines, ownEdit, ownInherit, flagNote, number } = fields
  // Only turning PR mode on waits for a remote and its profile (EKR-7): one already on stays free to turn off.
  const pullReadiness = state?.pullReadiness[project] ?? null
  const unguarded = !(switchOf(text('guard')) ?? shared.ci.guard)
  const sharedWait = shared.ci.waitMinutes === null ? '' : String(shared.ci.waitMinutes)
  const kinds = on('ownKinds') ? (draft.edit.kinds as readonly CiKind[]) : shared.ci.kinds
  const kindsText = (value: Value) => shown((value as CiKind[]).map((kind) => t.settings.ciKinds[kind]))
  const choices = remoteChoices(state?.profiles.profiles ?? [], state?.remotes[project] ?? [])
  // One profile on offer is no choice: the field shows only while there are two, or a choice was made.
  const remoteChoice = (kind: CiKind) => {
    const key = remoteKey(kind)
    const offered = choices[kind]
    const gone = text(key) !== '' && !offered.some((profile) => profile.id === text(key))
    if (offered.length < 2 && text(key) === '') return null
    const options = [
      { value: '', label: t.settings.remoteAuto },
      ...offered.map((profile) => ({ value: profile.id, label: profile.name })),
      ...(gone ? [{ value: text(key), label: t.settings.remoteGone }] : []),
    ]
    return <Fragment key={kind}>{pick(key, t.settings.remoteProfile(FORGES[kind]), t.settings.remoteProfileHint, options)}</Fragment>
  }
  return (
    <>
      <Section title={t.settings.sections.guard}>
        {inheritedSwitch('guard', t.settings.guard, t.settings.guardHint, shared.ci.guard)}
        {/* With the guard off the values stay as they are, only greyed out: turning it back on brings them back. */}
        <div className={unguarded ? 'settings__guarded settings__guarded--off' : 'settings__guarded'}>
          {lines('check', t.settings.check, t.settings.checkHint, t.settings.checkPlaceholder, 3, true, unguarded)}
          {lines('afterGreen', t.settings.afterGreen, t.settings.afterGreenHint, t.settings.afterGreenPlaceholder, 3, true, unguarded)}
          <fieldset className={marks.box(['ownKinds', 'kinds'], 'settings__field settings__group')}>
            <legend>
              <FieldHead label={t.settings.ci} hint={t.settings.ciHint} inherit={ownInherit('ownKinds', { kinds: shared.ci.kinds }, kindsText(shared.ci.kinds), unguarded)} mark={flagNote('ownKinds', ['kinds'], kindsText)} />
            </legend>
            <div className="settings__checks">
              {CI_KINDS.map((kind) => (
                <label key={kind} className="settings__check">
                  <input
                    type="checkbox"
                    checked={kinds.includes(kind)}
                    disabled={unguarded}
                    onChange={(event) =>
                      ownEdit('ownKinds', { kinds: shared.ci.kinds })(
                        'kinds',
                        CI_KINDS.filter((each) => (each === kind ? event.target.checked : kinds.includes(each))),
                      )
                    }
                  />
                  {t.settings.ciKinds[kind]}
                </label>
              ))}
            </div>
            <FieldNote error={errorOf('ci')} />
          </fieldset>
          <Row
            className={marks.box(['ownWait', 'wait'])}
            label={t.settings.ciWait}
            hint={t.settings.ciWaitHint}
            htmlFor={fieldId('wait')}
            inherit={ownInherit('ownWait', { wait: sharedWait }, sharedWait || t.settings.ciWaitPlaceholder, unguarded)}
            mark={flagNote('ownWait', ['wait'], (value) => ((value as string).trim() === '' ? t.settings.ciWaitPlaceholder : shown(value)))}
            control={number(
              'wait',
              on('ownWait') ? text('wait') : sharedWait,
              on('ownWait') && minutesOf(text('wait')) === undefined,
              (value) => ownEdit('ownWait', { wait: sharedWait })('wait', value),
              { placeholder: t.settings.ciWaitPlaceholder, disabled: unguarded },
            )}
          >
          </Row>
          {inheritedSwitch('recheck', t.settings.recheckMain, t.settings.recheckMainHint, shared.ci.recheckMain, unguarded)}
          {inheritedSwitch('fixTask', t.settings.fixTask, t.settings.fixTaskHint, shared.ci.fixTask, unguarded)}
          {inheritedSwitch('rerun', t.settings.rerunFailed, t.settings.rerunFailedHint, shared.ci.rerunFailed, unguarded)}
        </div>
      </Section>
      <Section title={t.settings.sections.pulls}>
        <SwitchField
          className={marks.box('pullRequests')}
          label={t.settings.pullRequests}
          hint={t.settings.pullRequestsHint}
          checked={on('pullRequests')}
          disabled={pullReadiness !== null && !on('pullRequests') && saved.pullRequests !== true}
          onChange={(checked) => edit('pullRequests', checked)}
          mark={marks.note('pullRequests')}
        >
          {notes('pullRequests')}
        </SwitchField>
        <div className="settings__line-extra">
          <PullHint readiness={pullReadiness} on={on('pullRequests')} />
          <AddPullProfile readiness={pullReadiness} />
        </div>
        {CI_KINDS.map(remoteChoice)}
      </Section>
    </>
  )
}
