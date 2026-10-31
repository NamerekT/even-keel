import { useState, type ReactNode } from 'react'
import type { EvenKeelState, FeedView } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { PlusIcon } from '../ui/icons.js'
import { MoreMenu } from '../ui/MoreMenu.js'
import { FeedDialog, useFeedDraft } from './FeedDialog.js'
import { linkedProfile, trackedFields } from './ProjectTracker.js'
import { SourceLine } from './SourceDialog.js'
import { EMPTY_FIELDS, keyTyped, placeOf, shapeOf, typedIn, type WizardFields } from './projectWizard.js'
import { FieldHead, fieldId, FieldNote, Section } from './settingsParts.js'
import { TrackerFields } from './TrackerFields.js'

/**
 * The sources of the project's tasks (BTN-553): its main tracker's line, given by the panel, then its extra task feeds
 * (BTN-66), places of other trackers or profiles whose tasks join its chain. A feed is added and removed at once,
 * without the save bar; a feed the chain has started tasks of keeps its profile. Each source's rules open in its window.
 */
export function FeedList({ state, project, main, mainTitle, tasks, modelLabels }: {
  state: EvenKeelState
  project: string
  main: ReactNode
  /** The main tracker's title, as the draft has it. */
  mainTitle: string
  tasks: readonly Task[]
  modelLabels: boolean
}) {
  const [adding, setAdding] = useState(false)
  const feeds = state.config.feeds[project] ?? []
  return (
    <Section
      title={t.settings.feeds}
      hint={t.settings.feedsHint}
      aside={
        !adding && (
          <button type="button" className="button button--small" onClick={() => setAdding(true)}>
            <PlusIcon />
            {t.settings.feedAdd}
          </button>
        )
      }
    >
      <div className="feeds__row">{main}</div>
      {feeds.map((feed) => (
        <FeedRow key={feed.id} state={state} project={project} feed={feed} tasks={tasks} modelLabels={modelLabels} />
      ))}
      {feeds.length === 0 && !adding && <p className="settings__hint">{t.settings.feedsNone(mainTitle)}</p>}
      {adding && <FeedAdd state={state} project={project} onClose={() => setAdding(false)} />}
    </Section>
  )
}

/** A feed: its line, then the tracker block with its place fixed, only the profile changing. */
function FeedRow({ state, project, feed, tasks, modelLabels }: { state: EvenKeelState; project: string; feed: FeedView; tasks: readonly Task[]; modelLabels: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const { send, sending, failure } = useCommand()
  const { dirty } = useFeedDraft(state, project, feed)
  const title = state.config.trackers.find((each) => each.name === feed.tracker)?.title ?? feed.tracker
  const own = state.profiles.profiles.filter((profile) => profile.kind === feed.tracker)
  const fields = trackedFields(state, feed.key, feed.tracker, linkedProfile(own, feed.id), feed.place ?? '')
  const locked = state.config.trackerLocked.includes(feed.id)
  const change = (edit: (before: WizardFields) => WizardFields) => {
    const next = edit(fields)
    if (next.profile === fields.profile) return
    const profile = own.find((each) => each.id === next.profile)
    void send('project/feed/profile', { project, feed: feed.id, profile: profile === undefined || profile.isDefault ? null : profile.id })
  }
  return (
    <div className="feeds__row">
      <SourceLine
        kind={feed.tracker}
        title={title}
        sourceKey={feed.key}
        own={Object.keys(feed.chain ?? {}).length > 0}
        dirty={dirty}
        onConfigure={() => setConfiguring(true)}
        menu={<MoreMenu label={t.settings.sourceMore(feed.key)} items={[{ label: t.settings.feedRemove, danger: true, pick: () => setConfirming(true) }]} />}
      />
      {configuring && <FeedDialog state={state} project={project} feed={feed} tasks={tasks} modelLabels={modelLabels} onClose={() => setConfiguring(false)} />}
      {confirming && (
        <ConfirmDialog
          title={t.settings.feedRemove}
          question={t.settings.feedRemoveQuestion(feed.key)}
          confirm={t.common.remove}
          cancel={t.common.cancel}
          busy={sending}
          onConfirm={() => void send('project/feed/remove', { project, feed: feed.id }).then((done) => done && setConfirming(false))}
          onClose={() => setConfirming(false)}
        />
      )}
      <TrackerFields
        ids={(field) => fieldId(`feed.${feed.id}.${field}`)}
        state={state}
        fields={fields}
        profiles={own}
        kinds={state.profiles.kinds.filter((kind) => kind.kind === feed.tracker)}
        profileHint={locked ? `${t.profiles.fieldHint} ${t.settings.feedLocked}` : t.profiles.fieldHint}
        keyFixed
        profileLocked={locked || sending}
        projectLocked
        soon={locked ? t.settings.trackerSoon : undefined}
        onChange={change}
      />
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}

/** A new feed, filled as the wizard fills a project: the profile picks the tracker, its projects are suggested. */
function FeedAdd({ state, project, onClose }: { state: EvenKeelState; project: string; onClose: () => void }) {
  const [fields, setFields] = useState<WizardFields>(EMPTY_FIELDS)
  const { send, sending, failure } = useCommand()
  const kinds = state.profiles.kinds.filter((kind) => kind.tracker)
  const profiles = state.profiles.profiles.filter((profile) => kinds.some((kind) => kind.kind === profile.kind))
  const profile = profiles.find((each) => each.id === fields.profile)
  const shape = shapeOf(state.config.trackers.find((each) => each.name === fields.tracker))
  const key = fieldId('feedAdd.key')
  const add = async () => {
    const place = placeOf({ ...fields, trackerProject: fields.trackerProject.trim() })
    const sent = { project, tracker: fields.tracker, key: fields.key.trim(), place: place === '' ? null : place, profile: profile === undefined || profile.isDefault ? null : profile.id }
    if (await send('project/feed/add', sent)) onClose()
  }
  return (
    <div className="settings__field feeds__add">
      <TrackerFields
        ids={(field) => fieldId(`feedAdd.${field}`)}
        state={state}
        fields={fields}
        profiles={profiles}
        kinds={kinds}
        profileHint={t.wizard.profileHint}
        onChange={setFields}
      />
      <div className="settings__row">
        {keyTyped(shape) && (
          <div className="settings__field">
            <FieldHead label={t.settings.feedKey} hint={t.settings.feedKeyHint} htmlFor={key} />
            <input
              id={key}
              className="settings__text settings__text--mono settings__short"
              spellCheck={false}
              value={fields.key}
              placeholder="ABCGH"
              onChange={(event) => setFields((before) => typedIn(before, 'key', event.target.value.toUpperCase()))}
            />
          </div>
        )}
        <div className="settings__field feeds__submit">
          <span className="account__actions">
            <button type="button" className="button button--small" disabled={sending || profile === undefined || fields.key.trim() === ''} onClick={() => void add()}>
              {t.settings.feedAdd}
            </button>
            <button type="button" className="button button--small" disabled={sending} onClick={onClose}>
              {t.common.cancel}
            </button>
          </span>
        </div>
      </div>
      <FieldNote error={failure} />
    </div>
  )
}
