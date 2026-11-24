import jsQR from 'jsqr'

/** A camera frame as canvas pixels. */
export interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * The text of a QR code in a frame, or `null` (BTN-1657). jsQR is plain JS with no network: Safari on iOS has no
 * `BarcodeDetector`, and one decoder on every browser is one thing to check. The invitation's code is dark on light,
 * so the inverted pass is skipped — it would double the time of every frame.
 */
export function readQr(frame: Frame): string | null {
  return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ?? null
}
