import { describe, expect, it } from 'vitest'
import { hulyClient } from './client.js'
import { colorlessFetcher, withoutBlankColors } from './colors.js'

const textCore = hulyClient.require<{ jsonToMarkup(json: unknown): string; markupToJSON(markup: string): unknown }>('@hcengineering/text-core')
const textMarkdown = hulyClient.require<{ markupToMarkdown(json: unknown, options?: { refUrl: string; imageUrl: string }): string }>('@hcengineering/text-markdown')
const modules = { markupToJSON: textCore.markupToJSON, markupToMarkdown: textMarkdown.markupToMarkdown }

const colored = (value: string, type: string, attrs: Record<string, unknown>) => ({ type: 'text', text: value, marks: [{ type, attrs }] })
const doc = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] })

describe('withoutBlankColors', () => {
  it('drops a blank colour, keeps the other attributes of a style and leaves the given tree alone', () => {
    const json = doc(colored('a', 'textStyle', { color: null, fontSize: '12px' }), colored('b', 'textColor', { color: 'blue' }), { type: 'text', text: 'c', marks: [{ type: 'bold' }] })
    const before = JSON.stringify(json)
    expect(withoutBlankColors(json)).toEqual(doc(colored('a', 'textStyle', { fontSize: '12px' }), colored('b', 'textColor', { color: 'blue' }), { type: 'text', text: 'c', marks: [{ type: 'bold' }] }))
    expect(JSON.stringify(json)).toBe(before)
  })
})

describe('colorlessFetcher', () => {
  const stored = textCore.jsonToMarkup(doc(colored('dim', 'textStyle', { color: null }), { type: 'text', text: ' and ' }, colored('red', 'textColor', { color: 'red' })))

  it('reads the markup and writes its Markdown without the blank colour mark', async () => {
    const formats: string[] = []
    const client = {
      markup: { refUrl: 'https://huly.example.com/browse', imageUrl: 'https://huly.example.com/files?file=' },
      fetchMarkup: async (_cls: string, _id: string, _attribute: string, _markup: string, format: string) => (formats.push(format), stored),
    }
    const markdown = await colorlessFetcher(client, modules)('tracker:class:Issue', 'id-1', 'description', 'blob-1', 'markdown')
    expect(markdown).toBe('dim and <span style="color: red" data-color="red">red</span>')
    expect(formats).toEqual(['markup'])
  })

  it('reads through the client when it has no link addresses', async () => {
    const client = { fetchMarkup: async () => 'as the client wrote it' }
    expect(await colorlessFetcher(client, modules)('c', 'id', 'description', 'blob', 'markdown')).toBe('as the client wrote it')
  })
})
