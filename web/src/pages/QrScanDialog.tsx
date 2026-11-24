import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../i18n/index.js'
import { useBackdropClose } from '../ui/backdrop.js'
import { Loading } from '../ui/Loader.js'
import { readQr } from './qrRead.js'
import { cameraProblem, scannedInvite } from './qrScan.js'
import '../tools/addPackage.css'
import './qrScanDialog.css'

/** A frame is read this often: enough to catch a code held up to the camera, light on a phone's battery. */
const EVERY_MS = 200
/** The frame is read at this longest side at most: the invitation's code is large in the picture, and jsQR is linear in pixels. */
const READ_SIDE = 720

/** `found` — what the last code read was when it was no invitation to open. */
type Seen = { at: 'starting' } | { at: 'looking'; found: string | null } | { at: 'failed'; text: string }

/**
 * "Scan a QR" of the sign-in screen (BTN-1657): the back camera in a window, read until an invitation of this address
 * shows up; its link is opened in this same window (`onFound`). A code of something else stays a line under the picture.
 */
export function QrScanDialog({ onFound, onClose }: { onFound: (url: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const backdrop = useBackdropClose(dialog, onClose)
  const heading = useId()
  const [seen, setSeen] = useState<Seen>({ at: 'starting' })

  useEffect(() => {
    if (dialog.current?.open === false) dialog.current.showModal()
  }, [])

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let over = false
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const stop = () => {
      over = true
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
    const look = () => {
      if (over) return
      const picture = video.current
      if (context !== null && picture !== null && picture.videoWidth > 0) {
        const scale = Math.min(1, READ_SIDE / Math.max(picture.videoWidth, picture.videoHeight))
        canvas.width = Math.round(picture.videoWidth * scale)
        canvas.height = Math.round(picture.videoHeight * scale)
        context.drawImage(picture, 0, 0, canvas.width, canvas.height)
        const text = readQr(context.getImageData(0, 0, canvas.width, canvas.height))
        if (text !== null) {
          const scanned = scannedInvite(text, location.origin)
          if (scanned.at === 'invite') {
            stop()
            onFound(scanned.url)
            return
          }
          setSeen({ at: 'looking', found: scanned.at === 'elsewhere' ? t.signIn.scanElsewhere(scanned.host) : t.signIn.scanNotInvite })
        }
      }
      timer = setTimeout(look, EVERY_MS)
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(async (got) => {
        stream = got
        if (over || video.current === null) return stop()
        video.current.srcObject = got
        await video.current.play()
        setSeen({ at: 'looking', found: null })
        look()
      })
      .catch((error: unknown) => {
        if (over) return
        stop()
        const problem = cameraProblem(error)
        setSeen({ at: 'failed', text: problem === 'blocked' ? t.signIn.scanBlocked : problem === 'noCamera' ? t.signIn.scanNoCamera : t.signIn.scanFailed })
      })
    return stop
  }, [])

  return (
    <dialog
      ref={dialog}
      className="add-package add-package--narrow qr-scan"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      {...backdrop}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={heading} className="add-package__title">
            {t.signIn.scanTitle}
          </h2>
        </header>
        {seen.at === 'failed' ? (
          <p role="alert" className="notice notice--error add-package__failure qr-scan__failure">
            {seen.text}
          </p>
        ) : (
          <div className="add-package__body qr-scan__body">
            <div className="qr-scan__view">
              {/* iOS plays a camera inline only with `playsInline` and `muted`; otherwise it goes full screen. */}
              <video ref={video} className="qr-scan__video" playsInline muted aria-label={t.signIn.scanView} />
              {seen.at === 'starting' && (
                <div className="qr-scan__wait">
                  <Loading busy label={t.signIn.scanStarting} fit="block" />
                </div>
              )}
            </div>
            <p className="qr-scan__state" role="status">
              {seen.at === 'looking' && seen.found !== null ? seen.found : t.signIn.scanAim}
            </p>
          </div>
        )}
        <footer className="add-package__foot">
          <span className="add-package__spacer" />
          <button type="button" className="button" onClick={onClose}>
            {t.signIn.scanClose}
          </button>
        </footer>
      </div>
    </dialog>
  )
}
