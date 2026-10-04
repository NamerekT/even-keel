import type { Language } from '../language.js'
import { fill } from '../sessions/prompt.js'

export type HandoffReason = 'limit' | 'restart' | 'checkpoint'

export interface PromptTexts {
  resume: string
  cleanup: string
  worktree: (path: string) => string
  branch: (branch: string) => string
  brief: (title: string) => string
  why: Record<HandoffReason, string>
  workdir: (path: string) => string
  transcript: (path: string) => string
  note: (path: string) => string
  begin: string
  recentSteps: string
  lastMessage: string
}

export const PROMPTS: Record<Language, PromptTexts> = {
  ru: {
    resume: 'Лимит сброшен — продолжай с того же места.',
    cleanup:
      '- Задачу закрывает слияние ветки в main основного чекаута. Worktree и ветку после этого не трогай и main не пушь — уборку сделает Even Keel.',
    worktree: (path) => fill`- Worktree готов: ${path} — работай в нём, новый worktree не создавай.`,
    branch: (branch) => fill`- Ветка: ${branch} — не меняй её.`,
    brief: (title) => fill`Задача из трекера: ${title}`,
    why: {
      limit: 'Продолжение: прошлая сессия по этой задаче упёрлась в лимит и остановлена, задачу доводишь ты.',
      restart: 'Продолжение: прошлую сессию по этой задаче остановил пользователь — она задачу не довела, доводишь ты.',
      checkpoint:
        'Продолжение: прошлая сессия по этой задаче поставила контрольную точку, чтобы не тащить раздутый контекст дальше, и остановлена — задачу доводишь ты.',
    },
    workdir: (path) => fill`- Рабочая папка: ${path} — работай в ней, новый worktree не создавай.`,
    transcript: (path) => fill`- Транскрипт прошлой сессии: ${path} — целиком не читай, ищи в нём grep, если чего-то не хватает.`,
    note: (path) => fill`- Записка о передаче: ${path} — прочитай её первой: что сделано, что осталось, следующая команда.`,
    begin: '- Начни с git status, git log main..HEAD и описания задачи.',
    recentSteps: 'Последние шаги прошлой сессии:',
    lastMessage: 'Последнее сообщение прошлой сессии:',
  },
  en: {
    resume: 'The usage limit has reset — carry on from where you stopped.',
    cleanup:
      '- Merging the branch into main of the main checkout closes the task. After that leave the worktree and the branch alone and do not push main — Even Keel cleans up.',
    worktree: (path) => fill`- Worktree is ready: ${path} — work in it, do not create a new worktree.`,
    branch: (branch) => fill`- Branch: ${branch} — do not change it.`,
    brief: (title) => fill`Task from the tracker: ${title}`,
    why: {
      limit: 'Continuation: the previous session on this task hit the usage limit and was stopped; you finish the task.',
      restart: 'Continuation: the user stopped the previous session on this task before it finished the task; you finish it.',
      checkpoint:
        'Continuation: the previous session on this task set a checkpoint so as not to carry a bloated context further, and was stopped; you finish the task.',
    },
    workdir: (path) => fill`- Working folder: ${path} — work in it, do not create a new worktree.`,
    transcript: (path) => fill`- Transcript of the previous session: ${path} — do not read it whole; grep it if something is missing.`,
    note: (path) => fill`- Handoff note: ${path} — read it first: what is done, what is left, the next command.`,
    begin: '- Start with git status, git log main..HEAD and the task description.',
    recentSteps: 'Last steps of the previous session:',
    lastMessage: 'Last message of the previous session:',
  },
}
