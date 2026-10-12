import type { Language } from '../language.js'
import { fail } from '../notice/notice.js'

export interface AskOption {
  label: string
  description: string
  /** What the CLI shows next to the option in a monospace box. */
  preview?: string
}

export interface AskQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: AskOption[]
}

/** An `AskUserQuestion` call: its tool use id and its questions. */
export interface Ask {
  id: string
  questions: AskQuestion[]
  /**
   * The call is known from the session's job file only: the CLI writes the message with a pending call into the
   * transcript once it is answered, and stopping the session before that loses the message.
   */
  unsaved?: true
}

/** Answers by question text: the chosen labels joined with ", ", or the user's own text. */
export type AskAnswers = Record<string, string>

export type ReplySource = 'page' | 'tracker'

export interface Reply {
  from: ReplySource
  /** Answers to the session's open question; empty for a reply to a question asked in plain text. */
  answers: AskAnswers
  text: string
  /** Absolute paths of the files the user sent along. */
  files: string[]
}

const LABEL_SEPARATOR = ', '

const TEXTS: Record<Language, { intro: Record<ReplySource, string>; asked: string; lost: string; comment: string; files: string; question: (count: number) => string; how: (several: boolean) => string }> = {
  ru: {
    intro: { page: 'Ответ пользователя со страницы Even Keel.', tracker: 'Ответ пользователя комментарием в трекере.' },
    asked:
      'Твой вызов AskUserQuestion выше остался без ответа в самом инструменте: сессию остановили и продолжили, чтобы передать ответ. Если вызов завершился ошибкой или прерыванием — это из-за остановки, ответ ниже.',
    lost:
      'Ты задал пользователю вопрос через AskUserQuestion. Чтобы передать ответ, сессию остановили и продолжили, а сообщение с вызовом CLI записать не успел: выше нет ни вызова, ни текста, который ты написал перед ним. Вот что ты спросил, ответ ниже.',
    comment: 'Комментарий пользователя:',
    files: 'Файлы от пользователя:',
    question: (count) => (count > 1 ? '**Сессия ждёт ответа на вопросы**' : '**Сессия ждёт ответа**'),
    how: (several) =>
      several
        ? 'Ответьте комментарием: по строке на вопрос, по порядку — номер варианта, несколько номеров через запятую или свой текст. Комментарий другого вида уйдёт сессии целиком.'
        : 'Ответьте комментарием: номер варианта (`2`), несколько через запятую (`1, 3`) или свой текст.',
  },
  en: {
    intro: { page: "The user's reply from the Even Keel page.", tracker: "The user's reply as a comment in the tracker." },
    asked:
      'Your AskUserQuestion call above got no answer in the tool itself: the session was stopped and resumed to pass the answer on. If the call ended in an error or an interruption, that is the stop; the answer is below.',
    lost:
      'You asked the user a question through AskUserQuestion. To pass the answer on, the session was stopped and resumed, and the CLI had not saved the message with the call: neither the call nor the text you wrote before it is in the conversation. Here is what you asked, the answer is below.',
    comment: "The user's comment:",
    files: 'Files from the user:',
    question: (count) => (count > 1 ? '**The session waits for answers**' : '**The session waits for an answer**'),
    how: (several) =>
      several
        ? 'Reply with a comment: a line per question, in order — the option number, several numbers separated by commas, or your own text. A comment of another shape goes to the session as a whole.'
        : 'Reply with a comment: the option number (`2`), several separated by commas (`1, 3`), or your own text.',
  },
}

/** The questions of an `AskUserQuestion` input; malformed questions and options are left out. */
export function questionsOf(input: unknown): AskQuestion[] {
  const questions = (input as { questions?: unknown } | null)?.questions
  if (!Array.isArray(questions)) return []
  return questions.flatMap((value): AskQuestion[] => {
    if (typeof value !== 'object' || value === null) return []
    const { question, header, multiSelect, options } = value as Record<string, unknown>
    if (typeof question !== 'string') return []
    return [
      {
        question,
        header: typeof header === 'string' ? header : '',
        multiSelect: multiSelect === true,
        options: Array.isArray(options) ? options.flatMap(optionOf) : [],
      },
    ]
  })
}

function optionOf(value: unknown): AskOption[] {
  if (typeof value !== 'object' || value === null) return []
  const { label, description, preview } = value as Record<string, unknown>
  if (typeof label !== 'string') return []
  return [{ label, description: typeof description === 'string' ? description : '', ...(typeof preview === 'string' && preview !== '' ? { preview } : {}) }]
}

/** The answers of an `AskUserQuestion` tool result (`toolUseResult.answers`); `null` when it carries none. */
export function toolAnswers(result: unknown): AskAnswers | null {
  const answers = (result as { answers?: unknown } | null)?.answers
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return null
  const entries = Object.entries(answers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length === 0 ? null : Object.fromEntries(entries)
}

/** The labels of the options an answer chose, by the CLI's way of joining them. */
export function chosenLabels(question: AskQuestion, answer: string | undefined): string[] {
  if (answer === undefined) return []
  if (question.options.some((option) => option.label === answer)) return [answer]
  const parts = answer.split(LABEL_SEPARATOR)
  return question.options.filter((option) => parts.includes(option.label)).map((option) => option.label)
}

/** The "Other" text of an answer: what is left once the option labels it names are taken out. */
export function otherAnswer(question: AskQuestion, answer: string | undefined): string {
  if (answer === undefined || question.options.some((option) => option.label === answer)) return ''
  const chosen = chosenLabels(question, answer)
  return joinLabels(answer.split(LABEL_SEPARATOR).filter((part) => !chosen.includes(part))).trim()
}

export function joinLabels(labels: string[]): string {
  return labels.join(LABEL_SEPARATOR)
}

/** The prompt that resumes a stopped session with the user's reply. Throws on an empty reply. */
export function replyPrompt(reply: Reply, ask: Ask | null, language: Language): string {
  const text = TEXTS[language]
  const answered = ask === null ? [] : ask.questions.filter((question) => (reply.answers[question.question] ?? '').trim() !== '')
  const comment = reply.text.trim()
  if (answered.length === 0 && comment === '' && reply.files.length === 0) throw fail('answer.empty', {})
  const blocks = [ask === null ? text.intro[reply.from] : `${text.intro[reply.from]}\n${ask.unsaved ? text.lost : text.asked}`]
  if (ask?.unsaved) blocks.push(askedText(ask))
  if (answered.length > 0) blocks.push(answered.map((question) => answerLine(question.question, reply.answers[question.question]!)).join('\n'))
  if (comment !== '') blocks.push(answered.length > 0 ? `${text.comment}\n${comment}` : comment)
  if (reply.files.length > 0) blocks.push([text.files, ...reply.files.map((file) => `- ${file}`)].join('\n'))
  return blocks.join('\n\n') + '\n'
}

/** The questions with their options numbered, a list of questions when there are several. */
function askedText(ask: Ask): string {
  const several = ask.questions.length > 1
  return ask.questions
    .flatMap((question, index) => [
      several ? `${index + 1}. ${oneLine(question.question)}` : oneLine(question.question),
      ...question.options.map((option, number) => `${several ? '   ' : ''}${number + 1}. ${optionLine(option)}`),
    ])
    .join('\n')
}

function optionLine(option: AskOption): string {
  return option.description === '' ? option.label : `${option.label} — ${option.description}`
}

function answerLine(question: string, answer: string): string {
  return `- "${oneLine(question)}" → ${oneLine(answer)}`
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The answers a reply prompt carries for the questions of `ask`, read back from its `- "question" → answer` lines. */
export function answersIn(prompt: string, ask: Ask): AskAnswers {
  const lines = prompt.split('\n')
  const answers: AskAnswers = {}
  for (const question of ask.questions) {
    const head = `- "${oneLine(question.question)}" → `
    const line = lines.find((each) => each.startsWith(head))
    if (line !== undefined) answers[question.question] = line.slice(head.length).trim()
  }
  return answers
}

/** The tracker comment that puts the session's question to the user, with numbered options. */
export function questionComment(ask: Ask, language: Language): string {
  const text = TEXTS[language]
  const several = ask.questions.length > 1
  const blocks = [text.question(ask.questions.length)]
  ask.questions.forEach((question, index) => {
    const title = several ? `${index + 1}. ${question.question}` : question.question
    blocks.push(question.header === '' ? title : `${title} _(${question.header})_`)
    if (question.options.length > 0) {
      blocks.push(question.options.map((option, number) => `${number + 1}. ${optionLine(option)}`).join('\n'))
    }
  })
  blocks.push(text.how(several))
  return blocks.join('\n\n')
}

/**
 * A comment answering `ask`: a number, numbers or text for one question; a line per question, in order, for several.
 * Numbers name options; text is the user's own answer. `null` — the comment does not fit, it goes to the session as text.
 */
export function trackerAnswers(comment: string, ask: Ask): AskAnswers | null {
  const text = comment.trim()
  if (text === '' || ask.questions.length === 0) return null
  if (ask.questions.length === 1) return { [ask.questions[0]!.question]: answerOf(ask.questions[0]!, text) }
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  if (lines.length !== ask.questions.length) return null
  return Object.fromEntries(ask.questions.map((question, index) => [question.question, answerOf(question, lines[index]!)]))
}

function answerOf(question: AskQuestion, text: string): string {
  if (!/^\d+(\s*[,;]?\s*\d+)*$/.test(text)) return text
  const numbers = [...new Set(text.match(/\d+/g)!.map(Number))]
  if (!question.multiSelect && numbers.length > 1) return text
  if (numbers.some((number) => number < 1 || number > question.options.length)) return text
  return joinLabels(numbers.map((number) => question.options[number - 1]!.label))
}
