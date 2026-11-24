import { useEffect, useState } from 'react'
import type { DevicesView } from '../../../src/access/view.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { formatAgo, formatFullTime, formatStamp } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { Band } from '../ui/blocks.js'
import { PlusIcon } from '../ui/icons.js'
import { Loading } from '../ui/Loader.js'
import { Tipped } from '../ui/Tipped.js'
import { addPasskey, passkeysWork, type AuthPost } from './passkey.js'
import { PageToken } from './SettingsSecrets.js'
import { FieldNote, Section } from './settingsParts.js'
import './signInSettings.css'

const KEY_GUIDE = 'https://github.com/NamerekT/even-keel/blob/main/docs/guide/setup.md#reaching-the-page-from-another-machine'

/**
 * The settings group "Sign-in and devices" (BTN-1619, `docs/web/sign-in.md`): the passkeys, the devices signed in with
 * their "Sign out", and the owner key. Each change is sent at once, no draft.
 */
export function SignInSettings({ state }: { state: EvenKeelState }) {
  const { read, query } = useLive()
  const [view, setView] = useState<DevicesView | null>(null)
  const [asked, setAsked] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const now = useNow(30_000)

  useEffect(() => {
    let live = true
    read<DevicesView>('auth/devices', {}).then(
      (next) => live && setView(next),
      (error: unknown) => live && setFailure(noticeOf(error)),
    )
    return () => {
      live = false
    }
  }, [asked])

  const post: AuthPost = <T,>(name: string, body: object) => query<T>(name, body as Record<string, unknown>)
  const act = async (step: () => Promise<unknown>, after: () => void = () => setAsked((count) => count + 1)) => {
    setBusy(true)
    setFailure(null)
    try {
      await step()
      after()
    } catch (error) {
      setFailure(noticeOf(error))
    } finally {
      setBusy(false)
    }
  }
  const signOut = () => act(() => post('auth/sign-out', {}), () => location.reload())
  const add = async () => {
    if ((await addPasskey(post)) === 'unsupported') throw new Error(t.signIn.unsupported)
  }

  return (
    <>
      {view !== null && !view.keySet && (
        <Band
          tone="warn"
          action={
            <a className="button button--small" href={KEY_GUIDE} target="_blank" rel="noreferrer">
              {t.signIn.unprotectedFix}
            </a>
          }
        >
          {t.signIn.unprotected}
        </Band>
      )}
      <Loading busy={view === null && failure === null} label={t.signIn.reading} fit="block">
        {view !== null && (
          <>
            <Section title={t.signIn.passkeys} hint={t.signIn.passkeysHint}>
              {view.passkeys.length === 0 ? (
                <p className="sign-ins__empty">{t.signIn.passkeysEmpty}</p>
              ) : (
                <ul className="sign-ins">
                  {view.passkeys.map((passkey) => (
                    <li key={passkey.id} className="sign-ins__row">
                      <span className="sign-ins__main">
                        <span className="sign-ins__name">{passkey.name}</span>
                        <Tipped tip={passkey.host} inline align="start">
                          <span className="sign-ins__when">{t.signIn.added(formatStamp(passkey.createdAt, now))}</span>
                        </Tipped>
                      </span>
                      <button type="button" className="button button--small" disabled={busy} onClick={() => void act(() => post('auth/passkey/remove', { id: passkey.id }))}>
                        {t.signIn.remove}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {passkeysWork() && view.current !== null && (
                <div className="sign-ins__actions">
                  <button type="button" className="button" disabled={busy} onClick={() => void act(add)}>
                    <PlusIcon />
                    {t.signIn.add}
                  </button>
                </div>
              )}
            </Section>
            <Section title={t.signIn.devices} hint={t.signIn.devicesHint}>
              {view.devices.length === 0 ? (
                <p className="sign-ins__empty">{t.signIn.devicesEmpty}</p>
              ) : (
                <ul className="sign-ins">
                  {view.devices.map((device) => {
                    const here = device.id === view.current
                    const seen = device.seenAt ?? device.createdAt
                    return (
                      <li key={device.id} className="sign-ins__row">
                        <span className="sign-ins__main">
                          <span className="sign-ins__name">
                            {device.device}
                            <span className="tag">{device.byKey ? t.signIn.byKey : t.signIn.byPasskey}</span>
                          </span>
                          {device.seenFrom !== null && (
                            <bdi className="sign-ins__from" dir="ltr">
                              {device.seenFrom}
                            </bdi>
                          )}
                        </span>
                        <span className="sign-ins__side">
                          <Tipped tip={formatFullTime(seen)} inline>
                            <span className="sign-ins__when">{formatAgo(seen, now)}</span>
                          </Tipped>
                          {here ? (
                            <span className="tag">{t.signIn.thisDevice}</span>
                          ) : (
                            <button type="button" className="button button--small" disabled={busy} onClick={() => void act(() => post('auth/devices/revoke', { id: device.id }))}>
                              {t.signIn.signOut}
                            </button>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {view.current !== null && (
                <div className="sign-ins__actions">
                  {view.devices.length > 1 && (
                    <button type="button" className="button" disabled={busy} onClick={() => void act(() => post('auth/devices/revoke-others', {}))}>
                      {t.signIn.signOutOthers}
                    </button>
                  )}
                  <button type="button" className="button" disabled={busy} onClick={() => void signOut()}>
                    {t.signIn.signOut}
                  </button>
                </div>
              )}
            </Section>
          </>
        )}
      </Loading>
      <FieldNote error={failure} />
      <Section title={t.signIn.ownerKey}>
        <PageToken state={state} />
      </Section>
    </>
  )
}
