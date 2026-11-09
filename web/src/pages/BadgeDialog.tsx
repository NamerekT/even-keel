import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { BadgeCheck } from '../../../src/badge/check.js'
import { BADGE_SECRET, type BadgeSettings } from '../../../src/badge/model.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { projectLabel } from '../state.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Band, CommandBlock } from '../ui/blocks.js'
import { GoToIcon } from '../ui/icons.js'
import { secretInput } from '../ui/secret.js'
import { Tipped } from '../ui/Tipped.js'
import { badgeDraft, badgeMarkdown, BADGE_GROUPS, groupOn, releasesLink, withGroup } from './badgeParts.js'
import { ErrorStrip, Row, Section, SwitchField } from './settingsParts.js'
import './settings.css'
import '../tools/addPackage.css'
import '../tools/packages.css'
import './badgeDialog.css'

/** How to deploy the Worker: its own README, written for users. */
const DEPLOY_GUIDE = 'https://github.com/NamerekT/even-keel/blob/main/deploy/badge/README.md'
/** The preview is drawn again no more often than this, however often the state comes. */
const PREVIEW_MS = 5_000

/**
 * The project's README badge over its page (BTN-917), as "Create status badge" of GitHub Actions: what the badge shows,
 * where it is published, a preview and the snippet for the README. Every change is written at once, not through the
 * settings panel's draft.
 */
export function BadgeDialog({ state, project, onClose }: { state: EvenKeelState; project: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const title = useId()
  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  const key = state.projectKeys[project] ?? project
  const form = state.config.projects[project]
  const badge = badgeDraft(form?.badge, key)
  const label = projectLabel(state, project)
  const toggles = useCommand()
  const save = (next: BadgeSettings) => toggles.send('project/badge', { project, badge: next })

  return createPortal(
    <dialog
      ref={dialog}
      className="add-package add-package--wide badge-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">
            {t.badge.title(label)}
          </h2>
          <button type="button" className="panel__close" aria-label={t.badge.close} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="add-package__body badge-dialog__body">
          {toggles.failure !== null && <Band tone="error">{say(toggles.failure)}</Band>}
          <PlaceSection project={project} badge={badge} state={state} disabled={toggles.sending} onSave={save} />
          <Section title={t.badge.show} hint={t.badge.showHint}>
            {BADGE_GROUPS.map((group) => (
              <SwitchField
                key={group.id}
                className="badge-dialog__field"
                label={t.badge.groups[group.id]}
                hint={t.badge.groupHints[group.id]}
                checked={groupOn(badge.fields, group)}
                disabled={toggles.sending}
                onChange={(on) => void save({ ...badge, fields: withGroup(badge.fields, group, on) })}
              />
            ))}
          </Section>
          <Preview project={project} label={label} fields={badge.fields.join()} />
          <Snippet state={state} project={project} badge={badge} name={form?.name ?? key} />
        </div>
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button button--primary" onClick={onClose}>
            {t.badge.done}
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  )
}

interface PlaceProps {
  project: string
  badge: BadgeSettings
  state: EvenKeelState
  disabled: boolean
  onSave: (next: BadgeSettings) => Promise<boolean>
}

/** On or off, the Worker's address, the name on it, the push secret and "Check". */
function PlaceSection({ project, badge, state, disabled, onSave }: PlaceProps) {
  const { query } = useLive()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<BadgeCheck | null>(null)
  const url = useTextField(badge.url, (value) => ({ ...badge, url: value }), project)
  const slug = useTextField(badge.slug, (value) => ({ ...badge, slug: value }), project)
  const ready = url.value.trim() !== '' && slug.value.trim() !== ''
  const check = async () => {
    setChecking(true)
    setResult(null)
    try {
      setResult(await query<BadgeCheck>('project/badge/check', { project, url: url.value, slug: slug.value }))
    } catch (reason) {
      setResult({ ok: false, notice: noticeOf(reason) })
    } finally {
      setChecking(false)
    }
  }
  const deploy = (
    <a className="badge-dialog__deploy" href={DEPLOY_GUIDE} target="_blank" rel="noreferrer">
      {t.badge.deploy}
      <GoToIcon />
    </a>
  )

  return (
    <Section title={t.badge.where} hint={t.badge.whereHint} aside={deploy}>
      <SwitchField className="badge-dialog__field" label={t.badge.on} hint={t.badge.onHint} checked={badge.on} disabled={disabled} onChange={(on) => void onSave({ ...badge, on })} />
      <TextRow wide label={t.badge.url} hint={t.badge.urlHint} field={url} placeholder="https://even-keel-badge.example.workers.dev" />
      <TextRow label={t.badge.slug} hint={t.badge.slugHint} field={slug} placeholder="project" />
      <SecretRow state={state} />
      <div className="badge-dialog__check">
        <Tipped tip={ready ? t.badge.checkTip : t.badge.checkNeeds} inline>
          <button type="button" className="button" aria-disabled={!ready || checking} onClick={() => ready && !checking && void check()}>
            {t.badge.check}
          </button>
        </Tipped>
        {result !== null && (
          <Band tone={result.ok ? 'note' : 'error'} className="badge-dialog__result">
            {say(result.notice)}
          </Band>
        )}
      </div>
    </Section>
  )
}

interface TextField {
  id: string
  value: string
  error: Notice | null
  edit: (value: string) => void
  commit: () => void
}

/** A text field written on leaving it or on Enter, its refusal in the strip under it. */
function useTextField(saved: string, next: (value: string) => BadgeSettings, project: string): TextField {
  const id = useId()
  const [value, setValue] = useState(saved)
  const [editing, setEditing] = useState(false)
  const { send, failure } = useCommand()
  useEffect(() => {
    if (!editing) setValue(saved)
  }, [saved, editing])
  return {
    id,
    value,
    error: failure,
    edit: (text) => {
      setEditing(true)
      setValue(text)
    },
    commit: () => {
      setEditing(false)
      if (value.trim() !== saved) void send('project/badge', { project, badge: next(value.trim()) })
    },
  }
}

function TextRow({ label, hint, field, placeholder, wide = false }: { label: string; hint: string; field: TextField; placeholder: string; wide?: boolean }) {
  return (
    <Row
      className={`badge-dialog__field badge-dialog__field--${wide ? 'wide' : 'text'}`}
      label={label}
      hint={hint}
      htmlFor={field.id}
      error={field.error}
      control={
        <input
          id={field.id}
          className="settings__text settings__text--mono"
          autoComplete="off"
          spellCheck={false}
          value={field.value}
          placeholder={placeholder}
          aria-invalid={field.error !== null}
          onChange={(event) => field.edit(event.target.value)}
          onBlur={field.commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              field.commit()
            }
          }}
        />
      }
    />
  )
}

/** The push secret, one for all projects: the page sees only whether it is set. */
function SecretRow({ state }: { state: EvenKeelState }) {
  const id = useId()
  const { send, sending, failure } = useCommand()
  const [value, setValue] = useState('')
  const view = state.secrets.variables.find((each) => each.name === BADGE_SECRET)
  const set = view?.set === true
  const outer = view?.outer === true
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (value !== '' && (await send('secrets/set', { name: BADGE_SECRET, value }))) setValue('')
  }
  return (
    <Row
      className="badge-dialog__field badge-dialog__field--text"
      label={t.badge.secret}
      hint={outer ? `${t.badge.secretHint}. ${t.badge.secretOuter}` : t.badge.secretHint}
      htmlFor={id}
      mark={!set && <span className="chip packages__unset">{t.badge.secretUnset}</span>}
      control={
        <ErrorStrip error={failure}>
          <form className="badge-dialog__secret" onSubmit={(event) => void submit(event)}>
            <input
              id={id}
              className="settings__text"
              {...secretInput()}
              value={value}
              disabled={outer}
              placeholder={set ? t.badge.secretSaved : undefined}
              aria-label={t.badge.secretValue}
              onChange={(event) => setValue(event.target.value)}
            />
            <button type="submit" className="button button--small" disabled={sending || value === '' || outer}>
              {t.badge.save}
            </button>
          </form>
        </ErrorStrip>
      }
    />
  )
}

/** The badge as the service draws it now, drawn again as the state moves, no more often than every 5 s. */
function Preview({ project, label, fields }: { project: string; label: string; fields: string }) {
  const { badgeUrl, state } = useLive()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [stamp, setStamp] = useState(() => Date.now())
  const last = useRef(stamp)
  useEffect(() => {
    const now = Date.now()
    if (now - last.current < PREVIEW_MS) return
    last.current = now
    setStamp(now)
  }, [state])
  useEffect(() => {
    last.current = Date.now()
    setStamp(last.current)
  }, [fields])
  const base = badgeUrl(project, theme)
  const src = base.startsWith('data:') ? base : `${base}&at=${stamp}`
  const pick = (
    <div className="segmented" role="group" aria-label={t.badge.preview}>
      {(['dark', 'light'] as const).map((each) => (
        <button
          key={each}
          type="button"
          className={theme === each ? 'segmented__item segmented__item--on' : 'segmented__item'}
          aria-pressed={theme === each}
          onClick={() => setTheme(each)}
        >
          {t.badge[each]}
        </button>
      ))}
    </div>
  )
  return (
    <Section title={t.badge.preview} hint={t.badge.previewHint} aside={pick}>
      <div className={`badge-dialog__preview badge-dialog__preview--${theme}`}>
        <img src={src} alt={t.badge.previewAlt(label)} />
      </div>
    </Section>
  )
}

/** The snippet for the README with its copy button, and where a press on the badge leads. */
function Snippet({ state, project, badge, name }: { state: EvenKeelState; project: string; badge: BadgeSettings; name: string }) {
  const id = useId()
  const found = releasesLink(state.remotes[project] ?? [])
  const [link, setLink] = useState<string | null>(null)
  const releases = link ?? found ?? ''
  const ready = badge.url !== '' && badge.slug !== ''
  return (
    <Section title={t.badge.markdown} hint={t.badge.markdownHint}>
      <Row
        className="badge-dialog__field badge-dialog__field--wide"
        label={t.badge.releases}
        hint={t.badge.releasesHint}
        htmlFor={id}
        control={
          <input
            id={id}
            className="settings__text settings__text--mono"
            autoComplete="off"
            spellCheck={false}
            value={releases}
            placeholder="https://github.com/owner/repo/releases"
            onChange={(event) => setLink(event.target.value)}
          />
        }
      />
      {ready ? (
        <CommandBlock className="badge-dialog__markdown" command={badgeMarkdown({ url: badge.url, slug: badge.slug, name, releases })} />
      ) : (
        <p className="badge-dialog__needs">{t.badge.markdownNeeds}</p>
      )}
    </Section>
  )
}
