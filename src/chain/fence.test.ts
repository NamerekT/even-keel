import { describe, expect, it } from 'vitest'
import { MESSAGE_LIMIT } from '../sessions/transcript.js'
import { closeFence } from './fence.js'
import { PROMPTS } from './prompts.js'

describe('closeFence', () => {
  it('leaves a text cut outside a code block as it is', () => {
    expect(closeFence('Intro.\n\n```\ncode\n```\n\nThe end', 100)).toBe('Intro.\n\n```\ncode\n```\n\nThe end')
    expect(closeFence('Plain text', 100)).toBe('Plain text')
  })

  it('closes a backtick block with a plain fence of the same length, without the language', () => {
    expect(closeFence('Intro.\n\n```ts\nconst a = 1\nconst b', 100)).toBe('Intro.\n\n```ts\nconst a = 1\nconst b\n```')
    expect(closeFence('````\nline', 100)).toBe('````\nline\n````')
  })

  it('closes a tilde block with tildes', () => {
    expect(closeFence('~~~~~ text\nline 1\nli', 100)).toBe('~~~~~ text\nline 1\nli\n~~~~~')
  })

  it('does not take a shorter fence or the other kind inside a block for its end', () => {
    expect(closeFence('````md\n```\ninner\n```\nmore', 100)).toBe('````md\n```\ninner\n```\nmore\n````')
    expect(closeFence('```\n~~~\nmore', 100)).toBe('```\n~~~\nmore\n```')
    expect(closeFence('~~~\n```\nmore', 100)).toBe('~~~\n```\nmore\n~~~')
  })

  it('takes a longer fence of the same kind for the end, but not one with text after it', () => {
    expect(closeFence('```\ncode\n`````\nafter', 100)).toBe('```\ncode\n`````\nafter')
    expect(closeFence('```\ncode\n``` not an end\nmore', 100)).toBe('```\ncode\n``` not an end\nmore\n```')
  })

  it('counts a fence indented up to three spaces and not one of four', () => {
    expect(closeFence('   ```\ncode', 100)).toBe('   ```\ncode\n```')
    expect(closeFence('    ```\ncode', 100)).toBe('    ```\ncode')
    expect(closeFence('```\ncode\n   ```\nafter', 100)).toBe('```\ncode\n   ```\nafter')
    expect(closeFence('```\ncode\n    ```\nmore', 100)).toBe('```\ncode\n    ```\nmore\n```')
  })

  it('does not take a backtick line with a backtick in its info string for an opening', () => {
    expect(closeFence('``` a`b\ntext', 100)).toBe('``` a`b\ntext')
  })

  it('does not add an empty line before the fence when the text ends with a line break', () => {
    expect(closeFence('```\ncode\n', 100)).toBe('```\ncode\n```')
  })

  it('cuts the text further so that the closing fence fits the limit', () => {
    const text = `\`\`\`\n${'x'.repeat(20)}`
    const closed = closeFence(text, 20)
    expect(closed).toBe(`\`\`\`\n${'x'.repeat(12)}\n\`\`\``)
    expect(closed.length).toBe(20)
  })
})

describe('the answer of a project without git', () => {
  const block = (count: number): string => Array.from({ length: count }, (_, index) => `line ${String(index).padStart(4, '0')} lorem ipsum dolor sit amet`).join('\n')

  it.each(['```', '~~~'])('puts the cut note under a block cut in the middle (%s)', (fence) => {
    const message = `Here it is:\n\n${fence}text\n${block(1500)}`.slice(0, MESSAGE_LIMIT)
    for (const language of ['en', 'ru'] as const) {
      const comment = PROMPTS[language].unchanged.answered(message, true)
      const note = language === 'en' ? '\n\n(The answer is cut' : '\n\n(Ответ обрезан'
      const body = comment.slice(0, comment.indexOf(note))
      expect(body.endsWith(`\n${fence}`)).toBe(true)
      expect(closeFence(body, Infinity)).toBe(body)
      expect(body.length - comment.indexOf(message.slice(0, 20))).toBeLessThanOrEqual(MESSAGE_LIMIT)
    }
  })

  it('leaves an answer that is not cut as it is', () => {
    expect(PROMPTS.en.unchanged.answered('```\nopen', false)).toBe("The session's answer:\n\n```\nopen")
  })
})
