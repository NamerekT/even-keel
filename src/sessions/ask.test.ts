import { describe, expect, it } from 'vitest'
import { answersIn, chosenLabels, otherAnswer, questionComment, questionsOf, replyParts, replyPrompt, toolAnswers, trackerAnswers, type Ask } from './ask.js'

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
  it('gives only the answer lines, the comment and the files for a question in the transcript', () => {
    const prompt = replyPrompt(
      { from: 'page', answers: { 'Which color?': 'Blue', 'Which sizes?': 'S, L' }, text: 'Also tidy up', files: ['C:/w/.temp/inbox/a.png'] },
      ASK,
      'en',
    )
    expect(prompt).toBe('- "Which color?" → Blue\n- "Which sizes?" → S, L\n\nAlso tidy up\n\nFiles from the user:\n- C:/w/.temp/inbox/a.png\n')
  })

  it('gives a plain reply as the user wrote it', () => {
    expect(replyPrompt({ from: 'tracker', answers: {}, text: 'Go with B', files: [] }, null, 'ru')).toBe('Go with B\n')
  })

  it('keeps an answer on one line', () => {
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'my\nown' }, text: '', files: [] }, ONE, 'en')
    expect(answersIn(prompt, ONE)).toEqual({ 'Which color?': 'my own' })
  })

  it('refuses an empty reply', () => {
    expect(() => replyPrompt({ from: 'page', answers: { 'Which color?': ' ' }, text: ' ', files: [] }, ONE, 'en')).toThrow()
  })

  it('repeats a question the stop lost in one line, with the description of the chosen option', () => {
    const lost: Ask = { ...ASK, unsaved: true }
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'Red (Recommended)', 'Which sizes?': 'S, L' }, text: '', files: [] }, lost, 'en')

    expect(prompt).toBe(
      'The question you asked through AskUserQuestion was lost when the session restarted:\n- "Which color?" → Red (Recommended)\n  Red (Recommended) — Warm\n- "Which sizes?" → S, L\n',
    )
    expect(answersIn(prompt, lost)).toEqual({ 'Which color?': 'Red (Recommended)', 'Which sizes?': 'S, L' })
  })

  it('repeats a lost question for a reply that answers it in its own words', () => {
    const prompt = replyPrompt({ from: 'tracker', answers: {}, text: 'Neither, go green', files: [] }, { ...ONE, unsaved: true }, 'en')

    expect(prompt).toBe('The question you asked through AskUserQuestion was lost when the session restarted:\n- "Which color?"\n\nNeither, go green\n')
  })
})

describe('answersIn', () => {
  it('reads back the answers of a reply prompt', () => {
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'Blue' }, text: '', files: [] }, ASK, 'ru')
    expect(answersIn(prompt, ASK)).toEqual({ 'Which color?': 'Blue' })
  })
})

describe('replyParts', () => {
  const FILES = ['C:/w/.temp/inbox/a.png']

  it('takes the answers, the own words and the files out of a reply prompt', () => {
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'Blue' }, text: 'Also\n\ntidy up', files: FILES }, ASK, 'en')
    expect(replyParts(prompt, ASK)).toEqual({ answers: { 'Which color?': 'Blue' }, text: 'Also\n\ntidy up', files: FILES })
  })

  it('reads a reply the CLI got with a line break first, so it did not start with a dash', () => {
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'Blue' }, text: 'Go', files: [] }, ASK, 'en')
    expect(replyParts(`\n${prompt}`, ASK)).toEqual({ answers: { 'Which color?': 'Blue' }, text: 'Go', files: [] })
  })

  it('reads the answers of a lost question without the call', () => {
    const lost: Ask = { ...ASK, unsaved: true }
    const prompt = replyPrompt({ from: 'page', answers: { 'Which color?': 'Red (Recommended)' }, text: 'Go', files: [] }, lost, 'ru')
    expect(replyParts(prompt, null)).toEqual({ answers: { 'Which color?': 'Red (Recommended)' }, text: 'Go', files: [] })
  })

  it('leaves answer-like lines of a plain prompt in its text', () => {
    expect(replyParts('- "Which color?" → Blue', null)).toEqual({ answers: {}, text: '- "Which color?" → Blue', files: [] })
  })

  it('reads a reply prompt of the old shape, with the source and the explanations', () => {
    const page = [
      "The user's reply from the Even Keel page.",
      'Your AskUserQuestion call above got no answer in the tool itself: the session was stopped and resumed to pass the answer on. If the call ended in an error or an interruption, that is the stop; the answer is below.',
      '',
      '- "Which color?" → Blue',
      '',
      "The user's comment:",
      'Also tidy up',
      '',
      'Files from the user:',
      '- C:/w/.temp/inbox/a.png',
      '',
    ].join('\n')
    expect(replyParts(page, ONE)).toEqual({ answers: { 'Which color?': 'Blue' }, text: 'Also tidy up', files: FILES })

    const lost = [
      'Ответ пользователя комментарием в трекере.',
      'Ты задал пользователю вопрос через AskUserQuestion. Чтобы передать ответ, сессию остановили и продолжили, а сообщение с вызовом CLI записать не успел: выше нет ни вызова, ни текста, который ты написал перед ним. Вот что ты спросил, ответ ниже.',
      '',
      'Which color?',
      '1. Red (Recommended) — Warm',
      '2. Blue',
      '',
      'Neither, go green',
      '',
    ].join('\n')
    expect(replyParts(lost, null)).toEqual({ answers: {}, text: 'Neither, go green', files: [] })
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
