import { describe, expect, it } from 'vitest'
import { replyPrompt } from './ask.js'
import { commandIn, matchingCommands } from './commands.js'
import { commandPrompt, typedText } from './commandPrompt.js'
import { userLine } from './transcript.js'

describe('commandIn', () => {
  it('reads a known command at the start, with and without words after it', () => {
    expect(commandIn('/handoff')).toMatchObject({ command: { name: 'handoff' }, args: '', start: 0, end: 8 })
    expect(commandIn('/handoff выбираю вариант 1.')).toMatchObject({ command: { name: 'handoff' }, args: 'выбираю вариант 1.' })
    expect(commandIn('/handoff\nкак договорились\n')).toMatchObject({ args: 'как договорились' })
  })

  it('takes spaces before the command and cuts them off', () => {
    expect(commandIn('  /handoff later')).toMatchObject({ command: { name: 'handoff' }, args: 'later', start: 2, end: 10 })
    expect(commandIn('\n /handoff')).toMatchObject({ start: 2, end: 10 })
  })

  it('does not read a command in the middle of the text', () => {
    expect(commandIn('please /handoff')).toBeNull()
    expect(commandIn('ok\n/handoff')).toBeNull()
  })

  it('does not read an unknown command or a name that only starts like one', () => {
    expect(commandIn('/huidoff now')).toBeNull()
    expect(commandIn('/handoffs')).toBeNull()
    expect(commandIn('/hand')).toBeNull()
    expect(commandIn('/')).toBeNull()
    expect(commandIn('//handoff')).toBeNull()
  })
})

describe('matchingCommands', () => {
  it('filters the registry by the typed name', () => {
    expect(matchingCommands('').map((command) => command.name)).toEqual(['handoff'])
    expect(matchingCommands('hand').map((command) => command.name)).toEqual(['handoff'])
    expect(matchingCommands('OFF').map((command) => command.name)).toEqual(['handoff'])
    expect(matchingCommands('plan')).toEqual([])
  })
})

describe('commandPrompt', () => {
  it('turns /handoff into the request for a note and the CHECKPOINT line, in both languages', () => {
    for (const language of ['en', 'ru'] as const) {
      const prompt = commandPrompt('/handoff', language)
      expect(prompt).toContain('`.temp/handoff.md`')
      expect(prompt).toContain('`CHECKPOINT: .temp/handoff.md`')
      expect(prompt).not.toMatch(/^\/handoff/)
    }
    expect(commandPrompt('/handoff', 'ru')).toMatch(/^Пользователь из чата/)
    expect(commandPrompt('/handoff', 'en')).toMatch(/^The user asks/)
  })

  it('adds the words after the command to the request', () => {
    const ru = commandPrompt('  /handoff выбираю вариант 1.', 'ru')
    expect(ru.startsWith(commandPrompt('/handoff', 'ru'))).toBe(true)
    expect(ru.endsWith('\nвыбираю вариант 1.')).toBe(true)
    const en = commandPrompt('/handoff pick option 1', 'en')
    expect(en.startsWith(commandPrompt('/handoff', 'en'))).toBe(true)
    expect(en.endsWith('\npick option 1')).toBe(true)
  })

  it('leaves anything else as written', () => {
    expect(commandPrompt('/huidoff now', 'en')).toBe('/huidoff now')
    expect(commandPrompt('please /handoff', 'ru')).toBe('please /handoff')
  })
})

describe('typedText', () => {
  it('gives back what was typed for an expanded command, with or without words, in either language', () => {
    for (const language of ['en', 'ru'] as const) {
      expect(typedText(commandPrompt('/handoff', language))).toBe('/handoff')
      expect(typedText(commandPrompt('/handoff выбираю вариант 1.', language))).toBe('/handoff выбираю вариант 1.')
    }
  })

  it('leaves other text alone', () => {
    expect(typedText('just a reply')).toBe('just a reply')
  })
})

describe('a chat command on its way', () => {
  it('reaches the session expanded and shows in the feed as typed', () => {
    const prompt = replyPrompt({ from: 'page', answers: {}, text: '/handoff выбираю вариант 1.', files: ['C:/w/.temp/inbox/a.png'] }, null, 'ru')
    expect(prompt).toContain('CHECKPOINT: .temp/handoff.md')
    expect(userLine('2026-10-30T10:00:00Z', prompt, null, (text) => text)).toEqual({
      at: '2026-10-30T10:00:00Z',
      kind: 'prompt',
      text: '/handoff выбираю вариант 1.',
      files: ['C:/w/.temp/inbox/a.png'],
    })
  })

  it('stays as written in a tracker comment', () => {
    expect(replyPrompt({ from: 'tracker', answers: {}, text: '/handoff', files: [] }, null, 'en')).toBe('/handoff\n')
  })
})
