// Runs in the page (an init script of scripts/guide-shots.ts), plain JS so that tsx does not wrap its functions in __name.
// The same seed on every load, so nothing random reaches a frame and a run without interface changes rewrites no file.
;(() => {
  let seed = 0x9e3779b9
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
})()

window.__guide = {
  /** A PNG (base64) cut to `crop` (device pixels) and encoded as WebP by the browser's own encoder; base64 back. */
  async webp(png, crop, quality) {
    const image = new Image()
    image.src = 'data:image/png;base64,' + png
    await image.decode()
    const part = crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
    if (part.x + part.width > image.naturalWidth || part.y + part.height > image.naturalHeight) {
      throw new Error('crop ' + JSON.stringify(part) + ' is outside the shot of ' + image.naturalWidth + 'x' + image.naturalHeight)
    }
    const canvas = document.createElement('canvas')
    canvas.width = part.width
    canvas.height = part.height
    canvas.getContext('2d').drawImage(image, part.x, part.y, part.width, part.height, 0, 0, part.width, part.height)
    const url = canvas.toDataURL('image/webp', quality)
    if (!url.startsWith('data:image/webp')) throw new Error('this browser does not encode WebP')
    return url.slice(url.indexOf(',') + 1)
  },
}
