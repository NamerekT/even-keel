import { useId } from 'react'
import { NOTICE_KINDS, PROJECT_KINDS, type NoticeKind } from '../../../src/notice/kinds.js'
import { say } from '../i18n/index.js'
import { noticeTexts } from '../i18n/notice-choices.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { Select } from '../ui/Select.js'
import { FieldNote, Row, Section, Switch } from './settingsParts.js'

// `cli.versions` has no banner since BTN-780, only entries of the event log: the config still takes it, the page offers none.
const SHARED_KINDS = (Object.keys(NOTICE_KINDS) as NoticeKind[]).filter((kind) => NOTICE_KINDS[kind] === 'global' && kind !== 'cli.versions')

/**
 * Settings → Notices (BTN-759): a switch per kind of warning; with `project`, the project's own value of each project
 * kind over Even Keel's. Each change is applied at once, as "Don't show again" on a banner is.
 */
export function NoticeSettings({ project }: { project?: string }) {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const texts = noticeTexts()
  if (state === null) return null
  const shared = state.config.shared.notices ?? {}
  const mute = (kind: NoticeKind, shown: boolean | null, own: string | null) => void send('notices/mute', { project: own, kind, shown })

  if (project !== undefined) {
    const own = state.config.projects[project]?.notices ?? {}
    return (
      <Section title={texts.title} hint={texts.projectHint}>
        {PROJECT_KINDS.map((kind) => (
          <ProjectKind
            key={kind}
            label={texts.kinds[kind]}
            value={own[kind] === undefined ? 'shared' : own[kind] ? 'on' : 'off'}
            sharedOn={shared[kind] ?? true}
            disabled={sending}
            onChange={(value) => mute(kind, value === 'shared' ? null : value === 'on', project)}
          />
        ))}
        <FieldNote error={failure} />
      </Section>
    )
  }

  const switches = (kinds: readonly NoticeKind[]) =>
    kinds.map((kind) => <SharedKind key={kind} label={texts.kinds[kind]} checked={shared[kind] ?? true} disabled={sending} onChange={(checked) => mute(kind, checked, null)} />)
  return (
    <>
      <Section title={texts.shared}>
        {switches(SHARED_KINDS)}
      </Section>
      <Section title={texts.projects} hint={texts.projectsHint}>
        {switches(PROJECT_KINDS)}
      </Section>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </>
  )
}

function SharedKind({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  const id = useId()
  return <Row className="settings__field" label={label} htmlFor={id} control={<Switch id={id} checked={checked} disabled={disabled} onChange={onChange} />} />
}

type Choice = 'shared' | 'on' | 'off'

function ProjectKind({ label, value, sharedOn, disabled, onChange }: { label: string; value: Choice; sharedOn: boolean; disabled: boolean; onChange: (value: Choice) => void }) {
  const id = useId()
  const texts = noticeTexts()
  return (
    <Row
      className="settings__field"
      label={label}
      htmlFor={id}
      control={
        <Select
          id={id}
          className="settings__text"
          value={value}
          disabled={disabled}
          options={[
            { value: 'shared', label: texts.asShared(sharedOn) },
            { value: 'on', label: texts.on },
            { value: 'off', label: texts.off },
          ]}
          onChange={(next) => onChange(next as Choice)}
        />
      }
    />
  )
}
