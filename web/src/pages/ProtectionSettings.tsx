import { Fold } from '../ui/Fold.js'
import { PROTECTION_GROUPS, type Protection } from '../../../src/sessions/protection.js'
import type { Notice } from '../../../src/notice/notice.js'
import { protectionMessages } from '../i18n/protection.js'
import { FieldHead, FieldNote, Section, SwitchField } from './settingsParts.js'
import { allTrackersOn, protectionDraft, protectionOf, protectionText, switched, TRACKER_PROTECTION } from './protectionDraft.js'

const AGENTS = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot', opencode: 'OpenCode' } as const
const EXAMPLES: Record<keyof typeof AGENTS, string> = { claude: 'Bash(git reset --hard*)', codex: '["git", "reset", "--hard"]', copilot: 'shell(git reset --hard:*)', opencode: 'git reset --hard*' }

export function ProtectionSettings({ value, shared, onChange, error = null }: { value: string; shared?: Protection; onChange: (value: string) => void; error?: Notice | null }) {
  const text = protectionMessages()
  const inherited = value === '' && shared !== undefined
  const draft = protectionDraft(inherited ? protectionText(shared) : value)
  const edit = (fields: Partial<typeof draft>) => onChange(JSON.stringify({ ...draft, ...fields }))
  return <Section title={text.title} hint={text.hint}>
    {shared !== undefined && <SwitchField className="settings__field" label={text.inherit} hint={text.inheritHint} checked={inherited} onChange={on => onChange(on ? '' : protectionText(shared))} />}
    {PROTECTION_GROUPS.filter(group => !TRACKER_PROTECTION.includes(group)).map(group => <SwitchField key={group} className="settings__field" label={text.groups[group]} hint={text.groupHints[group]} checked={!draft.disabled.includes(group)} onChange={on => edit({ disabled: switched(draft.disabled, [group], on) })} />)}
    <SwitchField className="settings__field" label={text.allTrackers} hint={text.allTrackersHint} checked={allTrackersOn(draft.disabled)} onChange={on => edit({ disabled: switched(draft.disabled, TRACKER_PROTECTION, on) })} />
    <div className="settings__nested">
      {PROTECTION_GROUPS.filter(group => TRACKER_PROTECTION.includes(group)).map(group => <SwitchField key={group} className="settings__field" label={text.groups[group]} hint={text.groupHints[group]} checked={!draft.disabled.includes(group)} onChange={on => edit({ disabled: switched(draft.disabled, [group], on) })} />)}
    </div>
    <Fold summary={<>{text.custom}</>}>
      {() => (
        <>
          {(Object.keys(AGENTS) as (keyof typeof AGENTS)[]).map(agent => <div className="settings__field" key={agent}>
            <FieldHead label={AGENTS[agent]} hint={text.native[agent]} htmlFor={`protection-${agent}`} />
            <textarea id={`protection-${agent}`} className="settings__text settings__text--mono" rows={3} value={draft[agent]} placeholder={EXAMPLES[agent]} onChange={event => edit({ [agent]: event.target.value })} />
          </div>)}
        </>
      )}
    </Fold>
    <FieldHead label={text.limitsLabel} hint={text.limits} />
    {value !== '' && protectionOf(value) === undefined && <p role="alert">{text.invalid}</p>}
    <FieldNote error={error} />
  </Section>
}
