/** Twice the badge's own size: sharp on a dense screen and after a site shrinks it. */
const SCALE = 2

/**
 * The badge's still SVG as a PNG drawn in the browser (BTN-920): sites that take neither SVG nor a picture by link
 * (Reddit, LinkedIn) get a snapshot. The SVG carries its fonts inside, so the canvas draws it as the preview shows it.
 */
export async function badgePng(svgUrl: string): Promise<Blob> {
  const response = await fetch(svgUrl)
  if (!response.ok) throw new Error(`badge: the picture answered ${response.status}`)
  const source = URL.createObjectURL(new Blob([await response.text()], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth * SCALE
    canvas.height = image.naturalHeight * SCALE
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('badge: no 2D canvas')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error('badge: the canvas gave no PNG')) : resolve(blob)), 'image/png'))
  } finally {
    URL.revokeObjectURL(source)
  }
}

/** Saves a file the page made, as a download. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
