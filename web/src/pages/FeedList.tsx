import { useState } from 'react'
import type { EvenKeelState, FeedView } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { Select } from '../ui/Select.js'
import { FieldHead, fieldId, FieldNote } from './settingsParts.js'

/**
 * The project's extra task feeds (BTN-66): places of other trackers or profiles whose tasks join its chain. Added and
 * removed at once, without the save bar; a feed the chain has started tasks of keeps its profile.
 */
export function FeedList({ state, project }: { state: EvenKeelState; project: string }) {
  const feeds = state.config.feeds[project] ?? []
  return (
    <section className="settings__field feeds">
      <FieldHead label={t.settings.feeds} hint={t.settings.feedsHint} />
      {feeds.length === 0 ? <p className="settings__hint">{t.settings.feedsNone}</p> : feeds.map((feed) => <FeedRow key={feed.id} state={state} project={project} feed={feed} />)}
      <FeedAdd state={state} project={project} />
    </section>
  )
}

function FeedRow({ state, project, feed }: { state: EvenKeelState; project: string; feed: FeedView }) {
  const [confirming, setConfirming] = useState(false)
  const { send, sending, failure } = useCommand()
  const title = state.config.trackers.find((each) => each.name === feed.tracker)?.title ?? feed.tracker
  const own = state.profiles.profiles.filter((profile) => profile.kind === feed.tracker)
  const current = own.find((profile) => profile.projectIds.includes(feed.id)) ?? own.find((profile) => profile.isDefault)
  const locked = state.config.trackerLocked.includes(feed.id)
  const pick = (value: string) => {
    const profile = own.find((each) => each.id === value)
    void send('project/feed/profile', { project, feed: feed.id, profile: profile === undefined || profile.isDefault ? null : profile.id })
  }
  return (
    <div className="feeds__row">
      <div className="settings__row feeds__line">
        <span className="tag">{feed.key}</span>
        <span className="feeds__place">
          {title}
          {feed.place !== undefined && <span className="settings__text--mono"> · {feed.place}</span>}
        </span>
        {own.length > 0 && (
          <Select
            id={fieldId(`feed.${feed.id}`)}
            className="settings__text settings__short"
            label={t.profiles.field}
            value={current?.id ?? ''}
            options={own.map((profile) => ({ value: profile.id, label: profile.isDefault ? t.profiles.byDefault(profile.name) : profile.name }))}
            disabled={locked || sending}
            onChange={pick}
          />
        )}
        <div className="account__actions">
          {confirming ? (
            <>
              <span className="accounts__confirm">{t.settings.feedRemoveQuestion(feed.key)}</span>
              <button type="button" className="button button--small button--danger" disabled={sending} onClick={() => void send('project/feed/remove', { project, feed: feed.id })}>
                {t.common.remove}
              </button>
              <button type="button" className="button button--small" disabled={sending} onClick={() => setConfirming(false)}>
                {t.common.cancel}
              </button>
            </>
          ) : (
            <button type="button" className="button button--small" onClick={() => setConfirming(true)}>
              {t.common.remove}
            </button>
          )}
        </div>
      </div>
      {locked && <p className="settings__hint">{t.settings.feedLocked}</p>}
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </div>
  )
}

function FeedAdd({ state, project }: { state: EvenKeelState; project: string }) {
  const [tracker, setTracker] = useState(state.config.trackers[0]?.name ?? '')
  const [profile, setProfile] = useState('')
  const [place, setPlace] = useState('')
  const [key, setKey] = useState('')
  const { send, sending, failure } = useCommand()
  const choice = state.config.trackers.find((each) => each.name === tracker)
  const own = state.profiles.profiles.filter((each) => each.kind === tracker)
  const fallback = own.find((each) => each.isDefault)
  const id = (field: string) => fieldId(`feedAdd.${field}`)
  const add = async () => {
    const sent = { project, tracker, key, place: choice?.projectKey == null || place.trim() === '' ? null : place, profile: profile === '' ? null : profile }
    if (!(await send('project/feed/add', sent))) return
    setPlace('')
    setKey('')
  }
  return (
    <div className="settings__row feeds__add">
      <div className="settings__field">
        <FieldHead label={t.settings.tracker} htmlFor={id('tracker')} />
        <Select
          id={id('tracker')}
          className="settings__text settings__short"
          value={tracker}
          options={state.config.trackers.map((each) => ({ value: each.name, label: each.title }))}
          onChange={(value) => {
            setTracker(value)
            setProfile('')
          }}
        />
      </div>
      {own.length > 0 && (
        <div className="settings__field">
          <FieldHead label={t.profiles.field} htmlFor={id('profile')} />
          <Select
            id={id('profile')}
            className="settings__text settings__short"
            value={profile}
            options={[
              ...(fallback === undefined ? [] : [{ value: '', label: t.profiles.byDefault(fallback.name) }]),
              ...own.filter((each) => !each.isDefault).map((each) => ({ value: each.id, label: each.name })),
            ]}
            onChange={setProfile}
          />
        </div>
      )}
      {choice?.projectKey != null && (
        <div className="settings__field settings__grow">
          <FieldHead label={t.settings.trackerProject(choice.name, choice.title)} htmlFor={id('place')} />
          <input
            id={id('place')}
            className="settings__text settings__text--mono"
            spellCheck={false}
            value={place}
            placeholder={choice.projectKey.example}
            onChange={(event) => setPlace(event.target.value)}
          />
        </div>
      )}
      <div className="settings__field">
        <FieldHead label={t.settings.feedKey} hint={t.settings.feedKeyHint} htmlFor={id('key')} />
        <input
          id={id('key')}
          className="settings__text settings__text--mono settings__short"
          spellCheck={false}
          value={key}
          placeholder="ABCGH"
          onChange={(event) => setKey(event.target.value.toUpperCase())}
        />
      </div>
      <div className="settings__field feeds__submit">
        <button type="button" className="button button--small" disabled={sending || key.trim() === ''} onClick={() => void add()}>
          {t.settings.feedAdd}
        </button>
      </div>
      <FieldNote error={failure} />
    </div>
  )
}
