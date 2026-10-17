// Runs in the page (an init script of scripts/shot.ts), plain JS so that tsx does not wrap its functions in __name.
window.__shot = {
  audit(root, limit) {
    const label = (el) => {
      const classes = [...el.classList].slice(0, 2).map((c) => '.' + c).join('')
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      return el.tagName.toLowerCase() + classes + (text ? ' "' + (text.length > 40 ? text.slice(0, 40) + '…' : text) + '"' : '')
    }
    const shown = (el) => {
      const style = getComputedStyle(el)
      return el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'contents'
    }
    // An SVG's shapes overlap by design, and a box of 1 px or less is the visually hidden pattern.
    const all = [root, ...root.querySelectorAll('*')].filter((el) => shown(el) && !(el instanceof SVGElement && el.ownerSVGElement))
    const SLACK = 2
    const spill = []
    const cut = []
    for (const el of all) {
      const style = getComputedStyle(el)
      const wide = el.scrollWidth - el.clientWidth
      const tall = el.scrollHeight - el.clientHeight
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue
      if (wide <= SLACK && tall <= SLACK) continue
      const size = (wide > SLACK ? 'w ' + el.scrollWidth + '>' + el.clientWidth : '') +
        (wide > SLACK && tall > SLACK ? ', ' : '') + (tall > SLACK ? 'h ' + el.scrollHeight + '>' + el.clientHeight : '')
      const clips = (axis) => axis === 'hidden' || axis === 'clip'
      if (clips(style.overflowX) || clips(style.overflowY)) {
        cut.push({ el, line: label(el) + ' ' + size + (style.textOverflow === 'ellipsis' ? ' (ellipsis)' : '') })
      } else if (style.overflowX === 'visible' || style.overflowY === 'visible') {
        spill.push({ el, line: label(el) + ' ' + size })
      }
    }
    const deepest = spill.filter((s) => !spill.some((o) => o !== s && s.el.contains(o.el)))
    const overlap = []
    for (const parent of all) {
      if (parent instanceof SVGElement) continue
      const kids = [...parent.children].filter((k) => shown(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position))
      if (kids.length > 60) continue
      const boxes = kids.map((k) => k.getBoundingClientRect())
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (w > 1 && h > 1) overlap.push(label(kids[i]) + ' / ' + label(kids[j]) + ' ' + Math.round(w) + '×' + Math.round(h))
        }
      }
    }
    const box = root.getBoundingClientRect()
    const capped = (lines) => lines.length > limit ? [...lines.slice(0, limit), '+' + (lines.length - limit) + ' more'] : lines
    return {
      box: Math.round(box.width) + '×' + Math.round(box.height) + ' at ' + Math.round(box.left) + ',' + Math.round(box.top),
      spill: capped(deepest.map((s) => s.line)),
      cut: capped(cut.map((c) => c.line)),
      overlap: capped(overlap),
    }
  },
}
