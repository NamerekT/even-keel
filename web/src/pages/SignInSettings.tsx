import { useEffect, useState } from 'react'
import type { DevicesView, DeviceView, InviteMade } from '../../../src/access/view.js'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'
import { formatAgo, formatClock, formatFullTime, formatStamp } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { Band } from '../ui/blocks.js'
import { ConfirmDialog } from '../ui/ConfirmDialog.js'
import { PlusIcon } from '../ui/icons.js'
import { Loading } from '../ui/Loader.js'
import { Tipped } from '../ui/Tipped.js'
import { InviteDialog } from './InviteDialog.js'
import { addPasskey, openedByIp, passkeysWork, type AuthPost } from './passkey.js'
import { PageToken } from './SettingsSecrets.js'
import { FieldNote, Section } from './settingsParts.js'
import './signInSettings.css'

/** How a device signed in: the key, or a passkey with the name it lives on, so two browsers of one kind tell apart. */
function methodOf(device: DeviceView): string {
  if (device.byKey) return t.signIn.byKey
  if (device.byInvite) return t.signIn.byInvite
  return device.passkeyHost === null ? t.signIn.byPasskey : t.signIn.byPasskeyAt(device.passkeyHost)
}

/**
 * The settings group "Sign-in and devices" (BTN-1619, `docs/web/sign-in.md`): the passkeys, the devices signed in with
 * their "Sign out", and the owner key. Each change is sent at once, no draft.
 */
export function SignInSettings({ state }: { state: EvenKeelState }) {
  const { read, query, onDevices } = useLive()
  const [view, setView] = useState<DevicesView | null>(null)
  const [asked, setAsked] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Notice | null>(null)
  const [made, setMade] = useState<InviteMade | null>(null)
  const [inviteFailure, setInviteFailure] = useState<Notice | null>(null)
  const [turningOff, setTurningOff] = useState(false)
  const now = useNow(view?.invites.length ? 1000 : 30_000)

  // A device signed in or out, an invitation opened or decided elsewhere: the service says so on the event stream.
  useEffect(() => onDevices(() => setAsked((count) => count + 1)), [onDevices])

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
  const invite = () => act(async () => setMade(await post<InviteMade>('auth/invites/create', {})))
  /** A decision taken on a row; the dialog of the same invitation closes with it. */
  const decide = (name: 'admit' | 'decline' | 'cancel', id: string, close = false) =>
    act(
      () => post(`auth/invites/${name}`, { id }),
      () => {
        if (close) setMade(null)
        setAsked((count) => count + 1)
      },
    )
  /** A decision taken in the dialog closes it; a refusal stays in it. */
  const inDialog = async (name: 'admit' | 'decline' | 'cancel') => {
    if (made === null) return
    setInviteFailure(null)
    try {
      await post(`auth/invites/${name}`, { id: made.id })
      setMade(null)
      setAsked((count) => count + 1)
    } catch (error) {
      setInviteFailure(noticeOf(error))
    }
  }
  const again = async () => {
    setInviteFailure(null)
    try {
      setMade(await post<InviteMade>('auth/invites/create', {}))
      setAsked((count) => count + 1)
    } catch (error) {
      setInviteFailure(noticeOf(error))
    }
  }

  return (
    <>
      {view !== null && !view.keySet && !view.signInOn && (
        <Band
          tone="warn"
          action={
            <button type="button" className="button button--small" disabled={busy} onClick={() => void invite()}>
              {t.signIn.invite}
            </button>
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
                        <bdi className="sign-ins__from" dir="ltr">
                          {passkey.host}
                        </bdi>
                      </span>
                      <span className="sign-ins__side">
                        <Tipped tip={formatFullTime(passkey.createdAt)} inline>
                          <span className="sign-ins__when">{t.signIn.added(formatStamp(passkey.createdAt, now))}</span>
                        </Tipped>
                        <button type="button" className="button button--small" disabled={busy} onClick={() => void act(() => post('auth/passkey/remove', { id: passkey.id }))}>
                          {t.signIn.remove}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {openedByIp() ? (
                <p className="sign-ins__empty">{t.signIn.noPasskeyByIp}</p>
              ) : (
                passkeysWork() &&
                view.current !== null && (
                  <div className="sign-ins__actions">
                    <button type="button" className="button" disabled={busy} onClick={() => void act(add)}>
                      <PlusIcon />
                      {t.signIn.add}
                    </button>
                  </div>
                )
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
                            <span className="tag sign-ins__way">{methodOf(device)}</span>
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
              {view.invites.length > 0 && (
                <ul className="sign-ins">
                  {view.invites.map((each) => (
                    <li key={each.id} className="sign-ins__row">
                      <span className="sign-ins__main">
                        <span className="sign-ins__name">
                          {t.signIn.inviteRow}
                          <span className="tag sign-ins__way">{each.opened === null ? t.signIn.inviteUnopened : each.opened.device}</span>
                        </span>
                        <span className="sign-ins__when">{t.signIn.inviteLeft(formatClock(Date.parse(each.expiresAt) - now.getTime()))}</span>
                      </span>
                      <span className="sign-ins__side">
                        {each.opened !== null && (
                          <>
                            <Tipped tip={t.signIn.inviteDigits} inline>
                              <span className="sign-ins__digits">{each.opened.digits}</span>
                            </Tipped>
                            <button type="button" className="button button--small" disabled={busy} onClick={() => void decide('admit', each.id, made?.id === each.id)}>
                              {t.signIn.inviteAdmit}
                            </button>
                            <button type="button" className="button button--small" disabled={busy} onClick={() => void decide('decline', each.id, made?.id === each.id)}>
                              {t.signIn.inviteDecline}
                            </button>
                          </>
                        )}
                        <button type="button" className="button button--small" disabled={busy} onClick={() => void decide('cancel', each.id, made?.id === each.id)}>
                          {t.signIn.inviteCancel}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="sign-ins__actions">
                <button type="button" className="button" disabled={busy} onClick={() => void invite()}>
                  <PlusIcon />
                  {t.signIn.invite}
                </button>
                {view.current !== null && view.devices.length > 1 && (
                  <button type="button" className="button" disabled={busy} onClick={() => void act(() => post('auth/devices/revoke-others', {}))}>
                    {t.signIn.signOutOthers}
                  </button>
                )}
                {view.current !== null && (
                  <button type="button" className="button" disabled={busy} onClick={() => void signOut()}>
                    {t.signIn.signOut}
                  </button>
                )}
              </div>
            </Section>
          </>
        )}
      </Loading>
      <FieldNote error={failure} />
      {made !== null && (
        <InviteDialog
          made={made}
          invite={view?.invites.find((each) => each.id === made.id)}
          busy={busy}
          failure={inviteFailure === null ? null : say(inviteFailure)}
          onAdmit={() => void inDialog('admit')}
          onDecline={() => void inDialog('decline')}
          onCancel={() => void inDialog('cancel')}
          onAgain={() => void again()}
          onClose={() => {
            setMade(null)
            setInviteFailure(null)
          }}
        />
      )}
      <Section title={t.signIn.ownerKey}>
        {view !== null && !view.keySet && view.signInOn && (
          <>
            <p className="sign-ins__empty">{t.signIn.signInOn}</p>
            <div className="sign-ins__actions">
              <button type="button" className="button" disabled={busy} onClick={() => setTurningOff(true)}>
                {t.signIn.signInOff}
              </button>
            </div>
          </>
        )}
        <PageToken state={state} />
      </Section>
      {turningOff && (
        <ConfirmDialog
          title={t.signIn.signInOff}
          question={t.signIn.signInOffQuestion}
          confirm={t.signIn.signInOffYes}
          cancel={t.signIn.signInOffNo}
          busy={busy}
          onConfirm={() => void act(() => post('auth/sign-in/off', {}), () => location.reload())}
          onClose={() => setTurningOff(false)}
        />
      )}
    </>
  )
}
