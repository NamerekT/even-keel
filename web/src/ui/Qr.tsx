import { useMemo } from 'react'
import { encode } from 'uqr'
import './qr.css'

/** The quiet zone a camera needs around the code, in modules. */
const QUIET = 4

/** `text` as a QR code, drawn on the page with no network (BTN-1655); black on white in both themes. */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { size, dots } = useMemo(() => {
    const code = encode(text, { ecc: 'M', border: QUIET })
    let path = ''
    code.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x},${y}h1v1h-1z`
      }),
    )
    return { size: code.size, dots: path }
  }, [text])
  return (
    <svg className={className === undefined ? 'qr' : `qr ${className}`} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className="qr__bg" width={size} height={size} />
      <path className="qr__dots" d={dots} />
    </svg>
  )
}
