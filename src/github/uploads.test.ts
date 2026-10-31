import { describe, expect, it } from 'vitest'
import { nextPage, signedLink, uploadId } from './uploads.js'

const ID = 'b24027f6-4820-4f55-9258-d80d7b7ca8d0'
const SIGNED = `https://private-user-images.githubusercontent.com/1001/691051256-${ID}.png?jwt=eyJ.example.sig`

describe('github uploads', () => {
  it('takes the upload id from an assets link and from a signed link', () => {
    expect(uploadId(`https://github.com/user-attachments/assets/${ID}`)).toBe(ID)
    expect(uploadId(SIGNED)).toBe(ID)
    expect(uploadId(`https://private-user-images.githubusercontent.com/1001/691051256-${ID}`)).toBe(ID)
  })

  it('has no upload id for a file link or a foreign host', () => {
    expect(uploadId('https://github.com/user-attachments/files/123/report.pdf')).toBeNull()
    expect(uploadId(`https://example.com/user-attachments/assets/${ID}`)).toBeNull()
    expect(uploadId('not a link')).toBeNull()
  })

  it('finds the signed link of the upload in body_html, its entities decoded', () => {
    const html = `<p>Here</p><a target="_blank" href="https://private-user-images.githubusercontent.com/1001/691051256-${ID}.png?jwt=a&amp;b=c"><img src="https://private-user-images.githubusercontent.com/1001/691051256-${ID}.png?jwt=a&amp;b=c" alt="shot"></a>`
    expect(signedLink(html, ID)).toBe(`https://private-user-images.githubusercontent.com/1001/691051256-${ID}.png?jwt=a&b=c`)
  })

  it('takes no signed link of another upload or another host', () => {
    const other = 'a0000000-0000-4000-8000-000000000000'
    const html = `<img src="https://private-user-images.githubusercontent.com/1001/1-${other}.png?jwt=x"><img src="https://example.com/1001/1-${ID}.png?jwt=x">`
    expect(signedLink(html, ID)).toBeNull()
    expect(signedLink('', ID)).toBeNull()
  })

  it('reads the next page of a Link header', () => {
    const link = '<https://api.github.com/repositories/1/issues/5/comments?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/issues/5/comments?per_page=100&page=3>; rel="last"'
    expect(nextPage(link)).toBe('https://api.github.com/repositories/1/issues/5/comments?per_page=100&page=2')
    expect(nextPage('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull()
    expect(nextPage(null)).toBeNull()
  })
})
