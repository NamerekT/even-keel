import { useEffect, useRef, useState } from 'react'
import type { JoinView } from '../../../src/access/view.js'
import { noticeOf } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { Card } from '../ui/blocks.js'
import { KeyIcon } from '../ui/icons.js'
import { Loading } from '../ui/Loader.js'
import { addPasskey, passkeysWork, type AuthPost, type Refusal } from './passkey.js'
import './settings.css'
import './signIn.css'

/** The new device's screen: the hub's answer, or this browser's own stages around it. */
type Stage = { at: 'opening' } | { at: 'view'; view: JoinView } | { at: 'offer' } | { at: 'failed'; text: string }

/** What each final answer says to the new device. */
const ENDS: Record<Exclude<JoinView['state'], 'waiting' | 'admitted'>, () => string> = {
  declined: () => t.signIn.joinDeclined,
  expired: () => t.signIn.joinExpired,
  cancelled: () => t.signIn.joinCancelled,
  used: () => t.signIn.joinUsed,
  gone: () => t.signIn.joinGone,
}

/**
 * `/invite#<secret>` (BTN-1655, `docs/web/sign-in.md`, "Invitations"): the new device opens the link, shows the two
 * digits and waits for "Let in" on the device that made it; then it is signed in and offered a passkey, as after the key.
 * A browser signed in already does not take the link: another device may be the one it was made for.
 */
export function InviteJoin({ signedIn, link, post, entered }: { signedIn: boolean; link: string; post: AuthPost; entered: () => void }) {
  const [stage, setStage] = useState<Stage>({ at: 'opening' })
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const following = useRef(false)

  const follow = async (first: 'auth/invite/open' | 'auth/invite/wait') => {
    if (following.current) return
    following.current = true
    try {
      let view = await post<JoinView>(first, first === 'auth/invite/open' ? { link } : {})
      setStage({ at: 'view', view })
      while (view.state === 'waiting') {
        view = await post<JoinView>('auth/invite/wait', {})
        setStage({ at: 'view', view })
      }
      if (view.state === 'admitted') {
        if (passkeysWork()) setStage({ at: 'offer' })
        else entered()
      }
    } catch (error) {
      setStage({ at: 'failed', text: say(noticeOf(error)) })
    } finally {
      following.current = false
    }
  }

  useEffect(() => {
    if (!signedIn) void follow('auth/invite/open')
  }, [])

  const add = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      const outcome: true | Refusal = await addPasskey(post)
      if (outcome === true) entered()
      else setRefusal(outcome === 'unsupported' ? t.signIn.unsupported : t.signIn.cancelled)
    } catch (error) {
      setRefusal(say(noticeOf(error)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="sign-in">
      <div className="sign-in__brand">
        <img className="sign-in__logo" src="/favicon.svg" alt="" width={40} height={40} />
        <span className="sign-in__name">Even Keel</span>
      </div>
      {signedIn ? (
        <Card className="sign-in__card" title={t.signIn.joinTitle}>
          <p className="sign-in__desc">{t.signIn.joinSignedIn}</p>
          <a className="button button--primary sign-in__wide" href="/">
            {t.signIn.joinToPage}
          </a>
        </Card>
      ) : stage.at === 'offer' ? (
        <Card className="sign-in__card" title={t.signIn.offerTitle}>
          <p className="sign-in__desc">{t.signIn.offerHint}</p>
          {refusal !== null && (
            <div className="notice notice--error" role="alert">
              {refusal}
            </div>
          )}
          <div className="sign-in__actions">
            <button type="button" className="button" disabled={busy} onClick={entered}>
              {t.signIn.offerLater}
            </button>
            <button type="button" className="button button--primary" disabled={busy} onClick={() => void add()}>
              <KeyIcon />
              {t.signIn.offerAdd}
            </button>
          </div>
        </Card>
      ) : (
        <Card className="sign-in__card" title={t.signIn.joinTitle}>
          <JoinBody stage={stage} retry={() => void follow('auth/invite/wait')} />
        </Card>
      )}
    </main>
  )
}

function JoinBody({ stage, retry }: { stage: Stage; retry: () => void }) {
  if (stage.at === 'opening') return <Loading busy label={t.signIn.joinOpening} fit="block" />
  if (stage.at === 'failed')
    return (
      <>
        <div className="notice notice--error" role="alert">
          {stage.text}
        </div>
        <button type="button" className="button button--primary sign-in__wide" onClick={retry}>
          {t.signIn.joinRetry}
        </button>
      </>
    )
  if (stage.at !== 'view' || stage.view.state === 'admitted') return <Loading busy label={t.signIn.joinOpening} fit="block" />
  const { view } = stage
  if (view.state === 'waiting')
    return (
      <>
        <p className="sign-in__digits" aria-label={view.digits.split('').join(' ')}>
          {view.digits}
        </p>
        <p className="sign-in__desc sign-in__center">{t.signIn.joinDigits}</p>
        <Loading busy label={t.signIn.joinWaiting} fit="block" />
      </>
    )
  return (
    <>
      <div className={view.state === 'declined' ? 'notice notice--error' : 'notice notice--warn'} role="alert">
        {ENDS[view.state]()}
      </div>
      <a className="button sign-in__wide" href="/">
        {t.signIn.joinToSignIn}
      </a>
    </>
  )
}
