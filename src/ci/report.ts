import type { CheckFailure, RedReport } from '../chain/model.js'
import type { Language } from '../language.js'
import type { CiJob, CiKind, CiRun } from './model.js'
import { CI_TITLES, shortCommit } from './verdict.js'

/** A failed run of main with what its CI tells of it: `jobs` — `null` when they could not be read, `log` — the failed job's tail. */
export interface FailedRun {
  kind: CiKind
  run: CiRun
  jobs: CiJob[] | null
  log: string | null
}

export interface RedFacts {
  commit: string
  runs: FailedRun[]
  /** `git log --format='%h %s'` from the last green commit to the red one. */
  commits: string[]
  /** `null` — no green commit is known, and `commits` are the latest ones of main. */
  green: string | null
  tasks: string[]
  /** The project's own check found main red (BTN-104); `runs` are then empty. */
  check?: CheckFailure
}

export const LOG_LINES = 60

interface Opening {
  title: (commit: string) => string
  intro: (commit: string) => string
  again: (commit: string) => string
  /** Opens the prompt of a fix session without a task. */
  session: (commit: string) => string
}

interface ReportTexts extends Opening {
  check: Opening & { failed: string; exited: (command: string, code: number) => string }
  runs: string
  job: string
  step: string
  log: string
  noLog: string
  commits: string
  noCommits: string
  tasks: string
  noTasks: string
}

const TEXTS: Record<Language, ReportTexts> = {
  en: {
    title: (commit) => `CI on main failed: ${commit}`,
    intro: (commit) => `The CI run of \`main\` failed on \`${commit}\`. Even Keel created this task: fix main; the chain takes it first.`,
    again: (commit) => `CI on main failed again on \`${commit}\`.`,
    session: (commit) => `The CI run of \`main\` failed on \`${commit}\`. Even Keel started this session to fix main; there is no tracker task for it.`,
    check: {
      title: (commit) => `Check of main failed: ${commit}`,
      intro: (commit) => `The project's check failed on \`main\` at \`${commit}\`. Even Keel created this task: fix main; the chain takes it first.`,
      again: (commit) => `The project's check failed again on \`${commit}\`.`,
      session: (commit) => `The project's check failed on \`main\` at \`${commit}\`. Even Keel started this session to fix main; there is no tracker task for it.`,
      failed: 'Failed check',
      exited: (command, code) => `\`${command}\` exited with code ${code}.`,
    },
    runs: 'Failed runs',
    job: 'job',
    step: 'failed step',
    log: 'Log tail',
    noLog: 'The log of the failed jobs is on the run page.',
    commits: 'Commits since the last green one',
    noCommits: 'The last green commit is unknown; the latest commits of main:',
    tasks: 'Tasks of the push',
    noTasks: 'none',
  },
  ru: {
    title: (commit) => `CI на main упал: ${commit}`,
    intro: (commit) => `Прогон CI на \`main\` упал на коммите \`${commit}\`. Задачу завёл Even Keel: нужно починить main, цепочка берёт её первой.`,
    again: (commit) => `CI на main снова упал на \`${commit}\`.`,
    session: (commit) => `Прогон CI на \`main\` упал на коммите \`${commit}\`. Эту сессию запустил Even Keel, чтобы починить main; задачи в трекере на это нет.`,
    check: {
      title: (commit) => `Проверка main упала: ${commit}`,
      intro: (commit) => `Проверка проекта упала на \`main\` на коммите \`${commit}\`. Задачу завёл Even Keel: нужно починить main, цепочка берёт её первой.`,
      again: (commit) => `Проверка проекта снова упала на \`${commit}\`.`,
      session: (commit) => `Проверка проекта упала на \`main\` на коммите \`${commit}\`. Эту сессию запустил Even Keel, чтобы починить main; задачи в трекере на это нет.`,
      failed: 'Упавшая проверка',
      exited: (command, code) => `\`${command}\` завершилась с кодом ${code}.`,
    },
    runs: 'Упавшие прогоны',
    job: 'задание',
    step: 'упал шаг',
    log: 'Хвост лога',
    noLog: 'Лог упавших заданий — на странице прогона.',
    commits: 'Коммиты от последнего зелёного',
    noCommits: 'Последний зелёный коммит неизвестен; последние коммиты main:',
    tasks: 'Задачи из пуша',
    noTasks: 'нет',
  },
}

/**
 * The fix task for a red main and the comment for one already open, in the language of the config;
 * the prompt of a fix session without a task, in the language of prompts.
 */
export function redReport(facts: RedFacts, language: Language, promptLanguage: Language = language): RedReport {
  const texts = TEXTS[language]
  const commit = shortCommit(facts.commit)
  const opening = facts.check === undefined ? texts : texts.check
  const body = bodyOf(facts, texts)
  const told = TEXTS[promptLanguage]
  return {
    title: opening.title(commit),
    description: `${opening.intro(commit)}\n\n${body}`,
    comment: `${opening.again(commit)}\n\n${body}`,
    prompt: `${(facts.check === undefined ? told : told.check).session(commit)}\n\n${bodyOf(facts, told)}`,
  }
}

function bodyOf(facts: RedFacts, texts: ReportTexts): string {
  return [...(facts.check === undefined ? runsOf(facts.runs, texts) : checkOf(facts.check, texts)), `## ${texts.commits}`, ...commitsOf(facts, texts)].join('\n\n')
}

function runsOf(failedRuns: FailedRun[], texts: ReportTexts): string[] {
  const runs = failedRuns.flatMap((failed) => [`- ${CI_TITLES[failed.kind]}: [${failed.run.workflow} #${failed.run.number}](${failed.run.url})`, ...jobLines(failed.jobs, texts)])
  const logs = failedRuns.filter((failed) => failed.log !== null && failed.log !== '')
  return [`## ${texts.runs}`, runs.join('\n'), ...(logs.length === 0 ? [texts.noLog] : [`## ${texts.log}`, ...logs.map((failed) => fenced(failed.log!))])]
}

function checkOf(check: CheckFailure, texts: ReportTexts): string[] {
  return [`## ${texts.check.failed}`, texts.check.exited(check.command, check.code), fenced(logTail(check.output))]
}

function commitsOf(facts: RedFacts, texts: ReportTexts): string[] {
  return [
    ...(facts.green === null ? [texts.noCommits] : []),
    fenced(facts.commits.join('\n')),
    `## ${texts.tasks}`,
    facts.tasks.length === 0 ? texts.noTasks : facts.tasks.join(', '),
  ]
}

function jobLines(jobs: CiJob[] | null, texts: ReportTexts): string[] {
  return (jobs ?? [])
    .filter((job) => job.status === 'failure')
    .map((job) => {
      const steps = (job.steps ?? []).filter((step) => step.status === 'failure').map((step) => step.name)
      return `  - ${texts.job} ${job.name}${steps.length === 0 ? '' : `, ${texts.step}: ${steps.join(', ')}`}`
    })
}

const fenced = (text: string): string => `\`\`\`text\n${text}\n\`\`\``

const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/

/** The last lines of a job log without GitHub's timestamps; a fence in it is defused so it cannot close the block. */
export function logTail(log: string, lines = LOG_LINES): string {
  const all = log.split(/\r?\n/).map((line) => line.replace(STAMP, '').replaceAll('```', "'''"))
  while (all.length > 0 && all.at(-1)!.trim() === '') all.pop()
  return all.slice(-lines).join('\n')
}
