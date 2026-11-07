import { useEffect, useId } from 'react'
import { CLOUD_WAYS, CLOUDS_READY, VERTEX_REGION_MODELS, type AwsProfiles, type Cloud, type CloudWay, type GcloudCredentials } from '../../../src/account/cloud.js'
import { cloudShortLived, withCloud, type CloudDraft } from '../cloudDraft.js'
import { t } from '../i18n/index.js'
import { HelpTip } from '../pages/settingsParts.js'
import { CommandBlock } from '../ui/blocks.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { Fold } from '../ui/Fold.js'
import { CheckIcon, PlusIcon, ServerIcon, TrashIcon } from '../ui/icons.js'
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
  /** The Google Cloud credentials of the user the service runs as; undefined until the service read them. */
  gcloud: GcloudCredentials | undefined
  /** Asks the service to read them (`account/gcloud`). */
  readGcloud: () => void
}

const ADC_LOGIN = 'gcloud auth application-default login'

/** A way's label or note: each cloud names its own ways, and `environment` is in both. */
function wayWord(words: Record<Cloud, Partial<Record<CloudWay, string>>>, cloud: Cloud, way: CloudWay): string {
  return words[cloud][way] ?? way
}

/**
 * The cloud way of a new Claude account (BTN-822, BTN-823): the clouds as cards — only the ones that can be added — then
 * the picked cloud's fields. Foundry gets a card of its own here.
 */
export function CloudFields({ draft, onDraft, aws, readAws, gcloud, readGcloud }: Props) {
  const group = useId()
  const set = (change: Partial<CloudDraft>) => onDraft({ ...draft, ...change })
  const vertex = draft.cloud === 'vertex'
  useEffect(() => {
    if (draft.cloud === 'bedrock' && draft.way === 'profile') readAws()
    if (vertex) readGcloud()
  }, [draft.cloud, draft.way])
  const profile = vertex ? undefined : aws?.profiles.find((each) => each.name === draft.profile.trim())
  const words = t.addAccount.cloud
  return (
    <>
      <fieldset className="add-package__field">
        <legend className="add-package__label add-package__legend">{words.legend}</legend>
        <div className="account-add__ways">
          {CLOUDS_READY.map((cloud) => (
            <label key={cloud} className="account-add__way">
              <input type="radio" name={group} value={cloud} checked={draft.cloud === cloud} onChange={() => onDraft(withCloud(draft, cloud))} />
              <span className="account-add__way-icon">
                <ServerIcon />
              </span>
              <span className="account-add__way-title">
                {words.clouds[cloud].title}
                <HelpTip text={words.tips[cloud]} align="start" />
              </span>
              <span className="account-add__way-check">
                <CheckIcon />
              </span>
              <span className="account-add__way-gets">{words.clouds[cloud].gets}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="add-package__field">
        <span className="add-package__label">{words.way[draft.cloud]}</span>
        <Select
          className="add-package__input"
          label={words.way[draft.cloud]}
          value={draft.way}
          options={CLOUD_WAYS[draft.cloud].map((way) => ({ value: way, label: wayWord(words.ways, draft.cloud, way) }))}
          onChange={(way) => set({ way: way as CloudWay })}
        />
      </div>
      <p className="add-package__note">{wayWord(words.wayNotes, draft.cloud, draft.way)}</p>
      {vertex ? <VertexAuthFields draft={draft} set={set} gcloud={gcloud} /> : <BedrockAuthFields draft={draft} set={set} aws={aws} />}
      <Text
        label={words.region}
        value={draft.region}
        onChange={(region) => set({ region })}
        placeholder={vertex ? words.regionVertex : profile?.region != null ? words.regionFromProfile(profile.region) : words.regionDefault}
        mono
      />
      {cloudShortLived(draft, aws, gcloud) && <p className="notice notice--warn">{words.shortLived[draft.cloud]}</p>}
      <Fold className="account-add__models" summary={<>{words.models}</>}>
        <div className="account-add__models-body">
          <p className="add-package__note">{words.modelsNote[draft.cloud]}</p>
          {(['opus', 'sonnet', 'haiku'] as const).map((family) => (
            <Text key={family} label={words.model[family]} value={draft[family]} onChange={(value) => set({ [family]: value })} mono />
          ))}
          {vertex ? (
            <ModelRegions draft={draft} set={set} />
          ) : (
            <Text label={words.regionPrefix} value={draft.regionPrefix} onChange={(regionPrefix) => set({ regionPrefix })} placeholder={words.regionPrefixHint} mono />
          )}
        </div>
      </Fold>
    </>
  )
}

interface FieldsProps {
  draft: CloudDraft
  set: (change: Partial<CloudDraft>) => void
}

function BedrockAuthFields({ draft, set, aws }: FieldsProps & { aws: AwsProfiles | undefined }) {
  const profileId = useId()
  const words = t.addAccount.cloud
  if (draft.way === 'profile') {
    return (
      <div className="add-package__field">
        <label className="add-package__label" htmlFor={profileId}>
          {words.profile}
        </label>
        <FieldStrip line={aws === undefined ? null : { tone: aws.profiles.length === 0 ? 'error' : 'plain', text: aws.profiles.length === 0 ? words.noProfiles(aws.user) : words.profilesOf(aws.user), short: aws.user }} wide>
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
    )
  }
  if (draft.way === 'apiKey') return <Secret label={words.key} value={draft.key} onChange={(key) => set({ key })} />
  if (draft.way === 'keys') {
    return (
      <>
        <Text label={words.accessKeyId} value={draft.accessKeyId} onChange={(accessKeyId) => set({ accessKeyId })} mono />
        <Secret label={words.secretAccessKey} value={draft.secretAccessKey} onChange={(secretAccessKey) => set({ secretAccessKey })} />
        <Secret label={words.sessionToken} value={draft.sessionToken} onChange={(sessionToken) => set({ sessionToken })} />
      </>
    )
  }
  return null
}

/** The Vertex way's own field, then the project: the CLI takes it only from the account, never from the key file. */
function VertexAuthFields({ draft, set, gcloud }: FieldsProps & { gcloud: GcloudCredentials | undefined }) {
  const projectId = useId()
  const words = t.addAccount.cloud
  const projects = gcloud?.projects ?? []
  return (
    <>
      {draft.way === 'adc' && gcloud !== undefined && gcloud.adcType === null && (
        <div className="notice notice--warn account-add__adc">
          <p>{words.noAdc(gcloud.user)}</p>
          <CommandBlock command={ADC_LOGIN} />
        </div>
      )}
      {draft.way === 'adc' && gcloud !== undefined && gcloud.adcType !== null && <p className="add-package__note">{words.adcOf(gcloud.user)}</p>}
      {draft.way === 'keyFile' && <Text label={words.keyFile} value={draft.keyFile} onChange={(keyFile) => set({ keyFile })} placeholder={words.keyFileHint} mono />}
      <div className="add-package__field">
        <label className="add-package__label" htmlFor={projectId}>
          {words.projectId}
        </label>
        <FieldStrip line={gcloud === undefined || projects.length === 0 ? null : { tone: 'plain', text: words.projectsOf(gcloud.user), short: gcloud.user }} wide>
          <SuggestField
            id={projectId}
            className="add-package__input add-package__input--mono"
            mono
            value={draft.projectId}
            options={projects.map((project) => ({ value: project, label: '' }))}
            onChange={(value) => set({ projectId: value })}
          />
        </FieldStrip>
      </div>
    </>
  )
}

/** The rows of `VERTEX_REGION_CLAUDE_*`: a model the account's region does not serve gets a region of its own. */
function ModelRegions({ draft, set }: FieldsProps) {
  const words = t.addAccount.cloud
  const rows = draft.modelRegions
  const change = (index: number, row: Partial<CloudDraft['modelRegions'][number]>) => set({ modelRegions: rows.map((each, at) => (at === index ? { ...each, ...row } : each)) })
  const free = VERTEX_REGION_MODELS.filter(([, variable]) => !rows.some((row) => row.variable === variable))
  return (
    <div className="add-package__field">
      <span className="add-package__label">{words.modelRegions}</span>
      <p className="add-package__note">{words.modelRegionsNote}</p>
      {rows.map((row, index) => (
        // By place, not by variable: picking another model must not remount the row and lose its focus.
        <div key={index} className="account-add__model-region">
          <Select
            className="add-package__input"
            label={words.modelRegionModel}
            value={row.variable}
            options={VERTEX_REGION_MODELS.filter(([, variable]) => variable === row.variable || free.some(([, open]) => open === variable)).map(([model, variable]) => ({ value: variable, label: model }))}
            onChange={(variable) => change(index, { variable })}
          />
          <input
            className="add-package__input add-package__input--mono"
            aria-label={words.modelRegionRegion}
            value={row.region}
            placeholder={words.modelRegionRegion}
            onChange={(event) => change(index, { region: event.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="button button--small account-add__model-region-remove"
            aria-label={words.removeModelRegion}
            title={words.removeModelRegion}
            onClick={() => set({ modelRegions: rows.filter((_, at) => at !== index) })}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <button type="button" className="button button--small account-add__model-region-add" onClick={() => set({ modelRegions: [...rows, { variable: free[0]![1], region: '' }] })}>
          <PlusIcon />
          {words.addModelRegion}
        </button>
      )}
    </div>
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
