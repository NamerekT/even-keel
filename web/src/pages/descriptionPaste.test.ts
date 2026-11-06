// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from './descriptionDoc.js'
import { meaningfulHtml, pastedPicture } from './descriptionPaste.js'

describe('meaningfulHtml', () => {
  it('takes clipboard HTML that holds Markdown meaning', () => {
    expect(meaningfulHtml('<meta charset="utf-8"><h2>Plan</h2><ul><li>one</li></ul>')).toBe(true)
    expect(meaningfulHtml('<p class=MsoNormal><b><span>Bold</span></b></p>')).toBe(true)
    expect(meaningfulHtml('see <a href="https://example.com">it</a>')).toBe(true)
  })

  it('leaves to plain text what only styles the text, such as a code editor copy', () => {
    expect(meaningfulHtml('<div style="color: red"><span>const a = 1</span><br></div>')).toBe(false)
    expect(meaningfulHtml('<span>a</span><img src="x.png">')).toBe(false)
    expect(meaningfulHtml('')).toBe(false)
  })
})

describe('pastedPicture', () => {
  it('sees a picture file or a picture inside the HTML', () => {
    expect(pastedPicture(['image/png'], '')).toBe(true)
    expect(pastedPicture([], '<p>text <img src="a.png"></p>')).toBe(true)
    expect(pastedPicture(['text/plain'], '<p>text</p>')).toBe(false)
  })
})

describe('htmlToMarkdown', () => {
  it('turns a rendered GitHub comment into Markdown', () => {
    const html =
      '<h2>Steps</h2><ol><li>Open the <strong>card</strong></li><li>Press <code>Edit</code></li></ol>' +
      '<pre><code class="language-ts">const a = 1</code></pre><p>See <a href="https://example.com">the docs</a>.</p>'
    expect(htmlToMarkdown(html)).toBe('## Steps\n\n1. Open the **card**\n2. Press `Edit`\n\n```ts\nconst a = 1\n```\n\nSee [the docs](https://example.com).')
  })

  it('keeps the meaning of a Word paragraph and drops its styling', () => {
    const html =
      '<p class=MsoNormal><b><span style="font-family:Calibri">Bold</span></b><span> and </span><i>italic</i><o:p></o:p></p>' +
      '<p class=MsoNormal>Second line</p>'
    expect(htmlToMarkdown(html)).toBe('**Bold** and *italic*\n\nSecond line')
  })

  it('keeps a table and a quote', () => {
    const html = '<table><tr><th>Key</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table><blockquote><p>quoted</p></blockquote>'
    expect(htmlToMarkdown(html)).toBe('| Key | Value |\n| --- | --- |\n| a | 1 |\n\n> quoted')
  })

  it('drops a picture and keeps the text around it', () => {
    expect(htmlToMarkdown('<p>before <img src="a.png"> after</p>')).toBe('before after')
  })
})
