import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Turn, TurnContext, TurnEnd } from '../agent/scripted.js'
import { runGit } from '../git/run.js'
import type { Language } from '../language.js'

/** What a demo task plays: the first two edit a file each, the third asks first, any other is a task the person added. */
export type DemoRole = 'welcome' | 'changelog' | 'tone' | 'added'

interface Texts {
  readme: string
  tasks: Record<Exclude<DemoRole, 'added'>, { title: string; description: string }>
  reading: string
  thinking: string
  testing: string
  welcome: string
  changelog: string
  question: string
  /** The answers to the question, the first the default; each with the line it writes. */
  tones: { label: string; line: string }[]
  added(task: string): string
  done(task: string): string
}

const TEXTS: Record<Language, Texts> = {
  en: {
    readme: '# Harbor log\n\nA small project Even Keel\'s demo works on. Nothing here leaves this folder.\n',
    tasks: {
      welcome: { title: 'Add a welcome line to the README', description: 'The README should greet whoever opens it, in one line under the title.' },
      changelog: { title: 'Start a changelog', description: 'A `CHANGELOG.md` with its first entry. Goes after the welcome line: the entry names it.' },
      tone: { title: 'Pick the tone of the greeting', description: 'A `GREETING.md` with one line. Which tone it takes is the person\'s call: ask.' },
    },
    reading: 'Reading the task and the project\'s rules',
    thinking: 'Planning the change',
    testing: 'Checking the files before the commit',
    welcome: 'Welcome aboard: this log is kept by Even Keel\'s demo.',
    changelog: '# Changelog\n\n## Unreleased\n\n- The README greets its reader.\n',
    question: 'Which tone should the greeting take?',
    tones: [
      { label: 'Friendly', line: 'Hi there, glad you dropped by!' },
      { label: 'Formal', line: 'Good day. Thank you for your visit.' },
    ],
    added: (task) => `# ${task}\n\nDone by the demo's script: a real session would do the task here.\n`,
    done: (task) => `${task} is done: committed and merged into the main branch.`,
  },
  ru: {
    readme: '# Судовой журнал\n\nМаленький проект, на котором работает демо Even Keel. Ничего отсюда не уходит за пределы папки.\n',
    tasks: {
      welcome: { title: 'Добавить приветствие в README', description: 'README должен приветствовать того, кто его открыл, — одной строкой под заголовком.' },
      changelog: { title: 'Завести журнал изменений', description: '`CHANGELOG.md` с первой записью. Идёт после приветствия: запись его называет.' },
      tone: { title: 'Выбрать тон приветствия', description: '`GREETING.md` с одной строкой. Какой тон — решает человек: спросить.' },
    },
    reading: 'Читаю задачу и правила проекта',
    thinking: 'Планирую правку',
    testing: 'Проверяю файлы перед коммитом',
    welcome: 'Добро пожаловать на борт: этот журнал ведёт демо Even Keel.',
    changelog: '# Журнал изменений\n\n## Не выпущено\n\n- README приветствует читателя.\n',
    question: 'Какой тон выбрать для приветствия?',
    tones: [
      { label: 'Дружелюбный', line: 'Привет, рады, что заглянули!' },
      { label: 'Официальный', line: 'Добрый день. Благодарим за визит.' },
    ],
    added: (task) => `# ${task}\n\nСделано сценарием демо: настоящая сессия выполнила бы задачу здесь.\n`,
    done: (task) => `${task} готова: закоммичена и влита в основную ветку.`,
  },
}

/** The pause between two actions of a demo turn, ms: long enough for the eye to follow. */
const PACE = [2_500, 3_000, 3_500, 2_000]

/** The demo repository's README, in the page's language. */
export function demoReadme(language: Language): string {
  return TEXTS[language].readme
}

/** The demo's three tasks, in the order they are created: the first blocks the second. */
export function demoTasks(language: Language): { role: Exclude<DemoRole, 'added'>; title: string; description: string }[] {
  const { tasks } = TEXTS[language]
  return (['welcome', 'changelog', 'tone'] as const).map((role) => ({ role, ...tasks[role] }))
}

/** The role of a task by its launch prompt, which carries its title: either language's, so a switch of the page's keeps it. */
export function roleOf(prompt: string): DemoRole {
  for (const texts of Object.values(TEXTS)) {
    for (const role of ['welcome', 'changelog', 'tone'] as const) if (prompt.includes(texts.tasks[role].title)) return role
  }
  return 'added'
}

/** The turn a demo task's session plays next: `plays` turns of it have begun before. */
export function demoTurn(role: DemoRole, plays: number, language: () => Language): Turn {
  return async (turn) => {
    const texts = TEXTS[language()]
    if (role === 'tone' && plays === 0) return ask(turn, texts)
    const answered = texts.tones.find((tone) => turn.prompt.includes(tone.label)) ?? Object.values(TEXTS).flatMap((each) => each.tones).find((tone) => turn.prompt.includes(tone.label))
    const change: Record<DemoRole, { file: string; text: () => Promise<string> }> = {
      welcome: { file: 'README.md', text: async () => withWelcome(await readFile(join(turn.cwd, 'README.md'), 'utf8'), texts.welcome) },
      changelog: { file: 'CHANGELOG.md', text: async () => texts.changelog },
      tone: { file: 'GREETING.md', text: async () => `${(answered ?? texts.tones[0]!).line}\n` },
      added: { file: `notes/${turn.task}.md`, text: async () => texts.added(turn.task) },
    }
    return work(turn, texts, change[role].file, change[role].text)
  }
}

async function ask(turn: TurnContext, texts: Texts): Promise<TurnEnd> {
  await look(turn, texts)
  turn.show({ text: texts.thinking, stage: 'recon', context: 31_000 })
  await wait(turn, PACE[2]!)
  return { ask: texts.question, options: texts.tones.map((tone) => tone.label) }
}

async function look(turn: TurnContext, texts: Texts): Promise<void> {
  turn.show({ text: texts.reading, stage: 'task', context: 9_000 })
  await wait(turn, PACE[0]!)
  turn.show({ text: 'README.md', tool: 'Read', stage: 'recon', context: 18_000 })
  await wait(turn, PACE[1]!)
}

/** A pause between two actions; a turn let go meanwhile (a stop, the demo removed) goes no further. */
async function wait(turn: TurnContext, ms: number): Promise<void> {
  await turn.pause(ms)
  if (!turn.live()) throw new Error(`demo: ${turn.task}: the turn is let go`)
}

/** Reads, edits `file`, checks, commits and merges, each step shown with a pause; done again after a restart, it changes nothing twice. */
async function work(turn: TurnContext, texts: Texts, file: string, text: () => Promise<string>): Promise<TurnEnd> {
  const { task, cwd, repo, git } = turn
  await look(turn, texts)
  turn.show({ text: texts.thinking, stage: 'recon', context: 26_000 })
  await wait(turn, PACE[3]!)
  turn.show({ text: file, tool: 'Edit', stage: 'edit', context: 38_000 })
  await mkdir(dirname(join(cwd, file)), { recursive: true })
  await writeFile(join(cwd, file), await text())
  await wait(turn, PACE[2]!)
  turn.show({ text: texts.testing, tool: 'Bash', stage: 'test', context: 45_000 })
  await wait(turn, PACE[1]!)
  turn.show({ text: `git commit -m "[${task}] …"`, tool: 'Bash', stage: 'commit', context: 49_000 })
  await git('add', file)
  if ((await runGit(cwd, ['diff', '--cached', '--quiet'])).code !== 0) await git('commit', '-q', '-m', `[${task}] ${file}`)
  await wait(turn, PACE[0]!)
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
  turn.show({ text: `git merge --no-edit ${branch}`, tool: 'Bash', stage: 'merge', context: 52_000 })
  const merged = await runGit(repo, ['merge', '--no-edit', branch])
  if (merged.code !== 0) throw new Error(`demo: the merge of ${branch}: ${merged.out}`)
  await wait(turn, PACE[3]!)
  return { say: texts.done(task) }
}

/** The README with the welcome line under its title, once. */
function withWelcome(readme: string, line: string): string {
  if (readme.includes(line)) return readme
  const [title, ...rest] = readme.split('\n')
  return [title, '', line, ...rest].join('\n')
}
