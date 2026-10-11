import { describe, expect, it } from 'vitest'
import { answersIn, chosenLabels, otherAnswer, questionComment, questionsOf, replyPrompt, toolAnswers, trackerAnswers, type Ask } from './ask.js'

const ASK: Ask = {
  id: 'toolu_1',
  questions: [
    {
      question: 'Which color?',
      header: 'Color',
      multiSelect: false,
      options: [
        { label: 'Red (Recommended)', description: 'Warm' },
        { label: 'Blue', description: '' },
      ],
    },
    { question: 'Which sizes?', header: 'Size', multiSelect: true, options: [{ label: 'S', description: '' }, { label: 'L', description: '' }] },
  ],
}
const ONE: Ask = { id: 'toolu_2', questions: [ASK.questions[0]!] }

describe('questionsOf', () => {
  it('reads nothing from a malformed input', () => {
    expect(questionsOf(undefined)).toEqual([])
    expect(questionsOf({ questions: 'no' })).toEqual([])
  })
})

describe('toolAnswers', () => {
  it('reads the string answers of a tool result', () => {
    expect(toolAnswers({ answers: { 'Which color?': 'Blue', bad: 1 } })).toEqual({ 'Which color?': 'Blue' })
    expect(toolAnswers({ answers: {} })).toBeNull()
    expect(toolAnswers('User has answered')).toBeNull()
  })
})

describe('chosenLabels', () => {
  it('splits the CLI answer into the labels it names', () => {
    expect(chosenLabels(ASK.questions[1]!, 'S, L')).toEqual(['S', 'L'])
    expect(chosenLabels(ASK.questions[0]!, 'Red (Recommended)')).toEqual(['Red (Recommended)'])
    expect(chosenLabels(ASK.questions[0]!, 'something else')).toEqual([])
    expect(chosenLabels(ASK.questions[0]!, undefined)).toEqual([])
  })
})

describe('otherAnswer', () => {
  it('is the part of the answer that names no option', () => {
    expect(otherAnswer(ASK.questions[0]!, 'something else')).toBe('something else')
    expect(otherAnswer(ASK.questions[0]!, 'Blue')).toBe('')
    expect(otherAnswer(ASK.questions[1]!, 'S, my own, L')).toBe('my own')
    expect(otherAnswer(ASK.questions[1]!, undefined)).toBe('')
  })
})

describe('replyPrompt', () => {
  it('names the interrupted call and lists the answers, the comment and the files', () => {
    const prompt = replyPrompt(
      { from: 'page', answers: { 'Which color?': 'Blue', 'Which sizes?': 'S, L' }, text: 'Also tidy up', files: ['C:/w/.temp/inbox/a.png'] },
      ASK,
      'en',
    )
    expect(prompt).toContain('AskUserQuestion')
    expect(prompt).toContain('- "Which color?" → Blue\n- "Which sizes?" → S, L')
    expect(prompt).toContain("The user's comment:\nAlso tidy up")
    expect(prompt).toContain('Files from the user:\n- C:/w/.temp/inbox/a.png')
  })

  it('gives a plain reply without the question block', () => {
    const prompt = replyPrompt({ from: 'tracker', answers: {}, text: 'Go with B', files: [] }, null, 'ru')
    expect(prompt).not.toContain('AskUserQuestion')
    expect(prompt).toContain('комментарием в трекере')
    expect(prompt.trim().endsWith('Go with B')).toBe(true)
  })

  it('keeps an answer on one line', () => {
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'my\nown' }, text: '', files: [] }, ONE, 'en')
    expect(answersIn(prompt, ONE)).toEqual({ 'Which color?': 'my own' })
  })

  it('refuses an empty reply', () => {
    expect(() => replyPrompt({ from: 'page', answers: { 'Which color?': ' ' }, text: ' ', files: [] }, ONE, 'en')).toThrow()
  })
})

describe('answersIn', () => {
  it('reads back the answers of a reply prompt', () => {
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'Blue' }, text: '', files: [] }, ASK, 'ru')
    expect(answersIn(prompt, ASK)).toEqual({ 'Which color?': 'Blue' })
  })
})

describe('questionComment', () => {
  it('numbers the options of each question', () => {
    const comment = questionComment(ASK, 'en')
    expect(comment).toContain('1. Which color? _(Color)_')
    expect(comment).toContain('1. Red (Recommended) — Warm\n2. Blue')
    expect(comment).toContain('a line per question')
    expect(questionComment(ONE, 'en')).toContain('`1, 3`')
  })
})

describe('trackerAnswers', () => {
  it('reads an option number, several numbers and plain text for one question', () => {
    expect(trackerAnswers('2', ONE)).toEqual({ 'Which color?': 'Blue' })
    expect(trackerAnswers(' 1 ', ONE)).toEqual({ 'Which color?': 'Red (Recommended)' })
    expect(trackerAnswers('Green, please', ONE)).toEqual({ 'Which color?': 'Green, please' })
  })

  it('keeps numbers as text when they do not fit the question', () => {
    expect(trackerAnswers('1, 2', ONE)).toEqual({ 'Which color?': '1, 2' })
    expect(trackerAnswers('3', ONE)).toEqual({ 'Which color?': '3' })
  })

  it('reads a line per question for several', () => {
    expect(trackerAnswers('2\n1, 2', ASK)).toEqual({ 'Which color?': 'Blue', 'Which sizes?': 'S, L' })
    expect(trackerAnswers('1 2', { ...ASK, questions: [ASK.questions[1]!] })).toEqual({ 'Which sizes?': 'S, L' })
  })

  it('gives up on a comment that does not match the questions', () => {
    expect(trackerAnswers('just do it', ASK)).toBeNull()
    expect(trackerAnswers('   ', ONE)).toBeNull()
  })
})
