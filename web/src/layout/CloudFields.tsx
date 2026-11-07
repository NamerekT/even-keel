import { useEffect, useId } from 'react'
import { BEDROCK_WAYS, CLOUDS_READY, type AwsProfiles, type BedrockWay } from '../../../src/account/cloud.js'
import { cloudShortLived, type CloudDraft } from '../cloudDraft.js'
import { t } from '../i18n/index.js'
import { HelpTip } from '../pages/settingsParts.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { Fold } from '../ui/Fold.js'
import { CheckIcon, ServerIcon } from '../ui/icons.js'
import { secretInput } from '../ui/secret.js'
import { Select } from '../ui/Select.js'
import { SuggestField } from '../ui/SuggestField.js'

interface Props {
  draft: CloudDraft
  onDraft: (draft: CloudDraft) => void
  /** The AWS profiles of the user the service runs as; undefined until the service read them. */
  aws: AwsProfiles | undefined
  /** Asks the service to read the AWS profiles (`account/aws`). */
  readAws: () => void
}

/**
 * The cloud way of a new Claude account (BTN-822): the clouds as cards — only the ones that can be added — then the picked
 * cloud's fields. Only Bedrock for now; Vertex and Foundry get cards of their own here.
 */
export function CloudFields({ draft, onDraft, aws, readAws }: Props) {
  const group = useId()
  const profileId = useId()
  const set = (change: Partial<CloudDraft>) => onDraft({ ...draft, ...change })
  useEffect(() => {
    if (draft.way === 'profile') readAws()
  }, [draft.way])
  const profile = aws?.profiles.find((each) => each.name === draft.profile.trim())
  return (
    <>
      <fieldset className="add-package__field">
        <legend className="add-package__label add-package__legend">{t.addAccount.cloud.legend}</legend>
        <div className="account-add__ways">
          {CLOUDS_READY.map((cloud) => (
            <label key={cloud} className="account-add__way">
              <input type="radio" name={group} value={cloud} checked={draft.cloud === cloud} onChange={() => set({ cloud })} />
              <span className="account-add__way-icon">
                <ServerIcon />
              </span>
              <span className="account-add__way-title">
                {t.addAccount.cloud.clouds[cloud].title}
                <HelpTip text={t.addAccount.cloud.bedrockTip} align="start" />
              </span>
              <span className="account-add__way-check">
                <CheckIcon />
              </span>
              <span className="account-add__way-gets">{t.addAccount.cloud.clouds[cloud].gets}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="add-package__field">
        <span className="add-package__label">{t.addAccount.cloud.way}</span>
        <Select
          className="add-package__input"
          label={t.addAccount.cloud.way}
          value={draft.way}
          options={BEDROCK_WAYS.map((way) => ({ value: way, label: t.addAccount.cloud.ways[way] }))}
          onChange={(way) => set({ way: way as BedrockWay })}
        />
      </div>
      <p className="add-package__note">{t.addAccount.cloud.wayNotes[draft.way]}</p>
      {draft.way === 'profile' && (
        <div className="add-package__field">
          <label className="add-package__label" htmlFor={profileId}>
            {t.addAccount.cloud.profile}
          </label>
          <FieldStrip line={aws === undefined ? null : { tone: aws.profiles.length === 0 ? 'error' : 'plain', text: aws.profiles.length === 0 ? t.addAccount.cloud.noProfiles(aws.user) : t.addAccount.cloud.profilesOf(aws.user), short: aws.user }} wide>
            <SuggestField
              id={profileId}
              className="add-package__input add-package__input--mono"
              mono
              value={draft.profile}
              options={(aws?.profiles ?? []).map((each) => ({ value: each.name, label: each.region ?? '' }))}
              onChange={(value) => set({ profile: value })}
            />
          </FieldStrip>
        </div>
      )}
      {draft.way === 'apiKey' && <Secret label={t.addAccount.cloud.key} value={draft.key} onChange={(key) => set({ key })} />}
      {draft.way === 'keys' && (
        <>
          <Text label={t.addAccount.cloud.accessKeyId} value={draft.accessKeyId} onChange={(accessKeyId) => set({ accessKeyId })} mono />
          <Secret label={t.addAccount.cloud.secretAccessKey} value={draft.secretAccessKey} onChange={(secretAccessKey) => set({ secretAccessKey })} />
          <Secret label={t.addAccount.cloud.sessionToken} value={draft.sessionToken} onChange={(sessionToken) => set({ sessionToken })} />
        </>
      )}
      <Text
        label={t.addAccount.cloud.region}
        value={draft.region}
        onChange={(region) => set({ region })}
        placeholder={profile?.region != null ? t.addAccount.cloud.regionFromProfile(profile.region) : t.addAccount.cloud.regionDefault}
        mono
      />
      {cloudShortLived(draft, aws) && <p className="notice notice--warn">{t.addAccount.cloud.shortLived}</p>}
      <Fold className="account-add__models" summary={<>{t.addAccount.cloud.models}</>}>
        <div className="account-add__models-body">
          <p className="add-package__note">{t.addAccount.cloud.modelsNote}</p>
          {(['opus', 'sonnet', 'haiku'] as const).map((family) => (
            <Text key={family} label={t.addAccount.cloud.model[family]} value={draft[family]} onChange={(value) => set({ [family]: value })} mono />
          ))}
          <Text
            label={t.addAccount.cloud.regionPrefix}
            value={draft.regionPrefix}
            onChange={(regionPrefix) => set({ regionPrefix })}
            placeholder={t.addAccount.cloud.regionPrefixHint}
            mono
          />
        </div>
      </Fold>
    </>
  )
}

function Text({ label, value, onChange, placeholder, mono = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="add-package__field">
      <span className="add-package__label">{label}</span>
      <input
        className={mono ? 'add-package__input add-package__input--mono' : 'add-package__input'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  )
}

function Secret({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="add-package__field">
      <span className="add-package__label">{label}</span>
      <input className="add-package__input add-package__input--mono" {...secretInput()} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
