import { useId, useState, type FormEvent } from 'react'
import { noticeOf } from '../../../src/notice/notice.js'
import { say, t } from '../i18n/index.js'
import { Card } from '../ui/blocks.js'
import { FieldStrip } from '../ui/FieldStrip.js'
import { KeyIcon } from '../ui/icons.js'
import { secretInput } from '../ui/secret.js'
import { addPasskey, passkeysWork, signInWithPasskey, type AuthPost } from './passkey.js'
import { HelpTip } from './settingsParts.js'
import './settings.css'
import './signIn.css'

type Stage = 'form' | 'offer'

/** A wrong key is the key field's strip; a passkey that failed is the band of the whole form. */
interface Failure {
  at: 'key' | 'form'
  text: string
}

/**
 * The page a browser gets before it is in (BTN-1619, `docs/web/sign-in.md`): a passkey in one press, or the owner key;
 * after the key, the offer to add a passkey here. `entered` loads the page anew once the browser holds its cookie.
 * A passkey lives on the host name it was made on: with none for this one (`passkeyHere`), the button gives way to a line.
 */
export function SignIn({ keySet, passkeyHere, post, entered }: { keySet: boolean; passkeyHere: boolean; post: AuthPost; entered: () => void }) {
  const [stage, setStage] = useState<Stage>('form')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const keyId = useId()
  const passkeys = passkeysWork()
  const button = passkeys && passkeyHere

  const run = async (at: Failure['at'], step: () => Promise<void>) => {
    setBusy(true)
    setFailure(null)
    try {
      await step()
    } catch (error) {
      setFailure({ at, text: say(noticeOf(error)) })
    } finally {
      setBusy(false)
    }
  }
  const cancelled = () => setFailure({ at: 'form', text: t.signIn.cancelled })
  const withPasskey = () =>
    run('form', async () => {
      if (await signInWithPasskey(post)) entered()
      else cancelled()
    })
  const withKey = (event: FormEvent) => {
    event.preventDefault()
    if (key.trim() === '') return
    void run('key', async () => {
      await post('auth/key', { key })
      if (passkeys) setStage('offer')
      else entered()
    })
  }
  const add = () =>
    run('form', async () => {
      if (await addPasskey(post)) entered()
      else cancelled()
    })
  const band = failure?.at === 'form' && (
    <div className="notice notice--error" role="alert">
      {failure.text}
    </div>
  )

  return (
    <main className="sign-in">
      <div className="sign-in__brand">
        <img className="sign-in__logo" src="/favicon.svg" alt="" width={40} height={40} />
        <span className="sign-in__name">Even Keel</span>
      </div>
      {stage === 'form' ? (
        <Card className="sign-in__card" title={t.signIn.title}>
          {button ? (
            <button type="button" className="button button--primary sign-in__wide" disabled={busy} onClick={() => void withPasskey()}>
              <KeyIcon />
              {busy && failure === null && key === '' ? t.signIn.passkeyWaiting : t.signIn.passkey}
            </button>
          ) : (
            <p className="sign-in__state">{passkeys ? t.signIn.noPasskeyOnName : t.signIn.noPasskeyHere}</p>
          )}
          {band}
          {keySet && (
            <>
              {button && (
                <div className="sign-in__or" aria-hidden="true">
                  {t.signIn.or}
                </div>
              )}
              <form className="sign-in__key" onSubmit={withKey}>
                <span className="settings__head-row">
                  <label className="settings__label" htmlFor={keyId}>
                    {t.signIn.key}
                  </label>
                  <HelpTip text={t.signIn.keyHint} />
                </span>
                <FieldStrip line={failure?.at === 'key' ? { tone: 'error', text: failure.text } : null} fold wide>
                  <input
                    id={keyId}
                    className="settings__text settings__text--mono sign-in__field"
                    {...secretInput()}
                    value={key}
                    disabled={busy}
                    onChange={(event) => setKey(event.target.value)}
                  />
                </FieldStrip>
                <button type="submit" className={button ? 'button sign-in__wide' : 'button button--primary sign-in__wide'} disabled={busy || key.trim() === ''}>
                  {t.signIn.enter}
                </button>
              </form>
            </>
          )}
        </Card>
      ) : (
        <Card className="sign-in__card" title={t.signIn.offerTitle}>
          <p className="sign-in__desc">{t.signIn.offerHint}</p>
          {band}
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
      )}
    </main>
  )
}
