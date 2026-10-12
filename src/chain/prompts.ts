import type { Language } from '../language.js'
import { fill } from '../sessions/prompt.js'

export type HandoffReason = 'limit' | 'restart' | 'checkpoint' | 'mainFixed'

/** `main` in the texts is the project's main branch, whatever it is called. */
export interface PromptTexts {
  resume: string
  cleanup: (main: string) => string
  worktree: (path: string) => string
  branch: (branch: string) => string
  brief: (title: string) => string
  project: (text: string) => string
  why: Record<HandoffReason, string>
  workdir: (path: string) => string
  transcript: (path: string) => string
  note: (path: string) => string
  begin: (main: string) => string
  recentSteps: string
  lastMessage: string
  unattended: string
  /** The rules of a session that fixes a red main without a task. */
  fixRules: (main: string) => string
  /** What a session stopped for a red main is told when it goes on; `fixed` — main after the fix, `null` — the fix was skipped. */
  mainFixed: (red: string, fixed: string | null, main: string) => string
}

export const PROMPTS: Record<Language, PromptTexts> = {
  ru: {
    resume: 'Лимит сброшен — продолжай с того же места.',
    cleanup: (main) =>
      fill`- Задачу закрывает слияние ветки в ${main} основного чекаута. Worktree и ветку после этого не трогай и ${main} не пушь — уборку сделает Even Keel.`,
    worktree: (path) => fill`- Worktree готов: ${path} — работай в нём, новый worktree не создавай.`,
    branch: (branch) => fill`- Ветка: ${branch} — не меняй её.`,
    brief: (title) => fill`Задача из трекера: ${title}`,
    project: (text) => fill`Указания для этого проекта:\n${text}`,
    why: {
      limit: 'Продолжение: прошлая сессия по этой задаче упёрлась в лимит и остановлена, задачу доводишь ты.',
      restart: 'Продолжение: прошлую сессию по этой задаче остановил пользователь — она задачу не довела, доводишь ты.',
      checkpoint:
        'Продолжение: прошлая сессия по этой задаче поставила контрольную точку, чтобы не тащить раздутый контекст дальше, и остановлена — задачу доводишь ты.',
      mainFixed: 'Продолжение: прошлую сессию по этой задаче остановил Even Keel, потому что упала проверка main, — задачу доводишь ты.',
    },
    workdir: (path) => fill`- Рабочая папка: ${path} — работай в ней, новый worktree не создавай.`,
    transcript: (path) => fill`- Транскрипт прошлой сессии: ${path} — целиком не читай, ищи в нём grep, если чего-то не хватает.`,
    note: (path) => fill`- Записка о передаче: ${path} — прочитай её первой: что сделано, что осталось, следующая команда.`,
    begin: (main) => fill`- Начни с git status, git log ${main}..HEAD и описания задачи.`,
    recentSteps: 'Последние шаги прошлой сессии:',
    lastMessage: 'Последнее сообщение прошлой сессии:',
    unattended: [
      'Режим без присмотра: пользователь недоступен, на вопросы до утра никто не ответит. Это правило важнее правил навыков о вопросах и статусах.',
      '- Вопросов не задавай и ответа не жди: AskUserQuestion не вызывай, ход вопросом не заканчивай.',
      '- Сделай в задаче всё, что можно сделать без ответа. Вопрос держит только ту часть, которую решает; остальное — код, тесты, документацию — доведи до конца.',
      '- Вопрос с разумным вариантом по умолчанию тебя не держит: возьми вариант, который дешевле всего откатить, доведи задачу на нём и слей, а вопрос заведи отдельной задачей, как обычно.',
      '- Если без ответа задачу не закончить:',
      '  1. Доделай всё, что от ответа не зависит.',
      '  2. Закоммить работу в ветку задачи так, чтобы git status был пуст: нужное — в коммит, временное — удали. Ветку в main не сливай.',
      '  3. Комментарием к задаче: что сделано, что осталось, вопрос с вариантами ответа и что меняет каждый. Повесь на задачу ярлык вопроса (Question или Вопрос — какой уже есть в трекере).',
      '  4. Последним шагом, после последнего коммита, переведи задачу в Backlog: git-хук после коммита двигает задачу вперёд. Через полминуты проверь статус и, если хук его сдвинул, верни Backlog.',
      '  5. Закончи ход коротким отчётом. Следующую задачу Even Keel возьмёт сам, утром пользователь ответит в задаче или в этой сессии.',
    ].join('\n'),
    fixRules: (main) =>
      [
        '- Задачи в трекере на эту починку нет: не заводи её и статусы не трогай, в сообщениях коммитов ID задач не пиши.',
        fill`- Починку слей в ${main} основного чекаута (git merge --no-edit в основной рабочей копии). Worktree и ветку после этого не трогай и ${main} не пушь — уборку сделает Even Keel, он же проверит пуш.`,
      ].join('\n'),
    mainFixed: (red, fixed, main) =>
      fixed === null
        ? fill`Even Keel остановил тебя посреди хода: проверка ${main} упала на коммите ${red}. Починка не подтверждена — ${main} может быть ещё сломан. Подтяни ${main} в свою ветку, разреши конфликты, если будут, и продолжай задачу.`
        : fill`Even Keel остановил тебя посреди хода: проверка ${main} упала на коммите ${red}. Она починена, ${main} теперь на коммите ${fixed}. Подтяни ${main} в свою ветку, разреши конфликты, если будут, и продолжай задачу.`,
  },
  en: {
    resume: 'The usage limit has reset — carry on from where you stopped.',
    cleanup: (main) =>
      fill`- Merging the branch into ${main} of the main checkout closes the task. After that leave the worktree and the branch alone and do not push ${main} — Even Keel cleans up.`,
    worktree: (path) => fill`- Worktree is ready: ${path} — work in it, do not create a new worktree.`,
    branch: (branch) => fill`- Branch: ${branch} — do not change it.`,
    brief: (title) => fill`Task from the tracker: ${title}`,
    project: (text) => fill`Instructions for this project:\n${text}`,
    why: {
      limit: 'Continuation: the previous session on this task hit the usage limit and was stopped; you finish the task.',
      restart: 'Continuation: the user stopped the previous session on this task before it finished the task; you finish it.',
      checkpoint:
        'Continuation: the previous session on this task set a checkpoint so as not to carry a bloated context further, and was stopped; you finish the task.',
      mainFixed: 'Continuation: Even Keel stopped the previous session on this task because the check of main failed; you finish the task.',
    },
    workdir: (path) => fill`- Working folder: ${path} — work in it, do not create a new worktree.`,
    transcript: (path) => fill`- Transcript of the previous session: ${path} — do not read it whole; grep it if something is missing.`,
    note: (path) => fill`- Handoff note: ${path} — read it first: what is done, what is left, the next command.`,
    begin: (main) => fill`- Start with git status, git log ${main}..HEAD and the task description.`,
    recentSteps: 'Last steps of the previous session:',
    lastMessage: 'Last message of the previous session:',
    unattended: [
      'Unattended mode: the user is away, and nobody will answer a question until morning. This rule outranks what the skills say about questions and statuses.',
      '- Ask nothing and wait for no answer: do not call AskUserQuestion, do not end the turn with a question.',
      '- Do everything in the task that can be done without an answer. A question holds only the part it decides; finish the rest — code, tests, docs.',
      '- A question with a sensible default does not hold you: take the option that is cheapest to undo, finish the task on it and merge, and file the question as its own task, as usual.',
      '- If the task cannot be finished without an answer:',
      '  1. Finish everything that does not depend on the answer.',
      '  2. Commit the work to the task branch so that git status is clean: what is needed goes into a commit, scratch is deleted. Do not merge the branch into main.',
      '  3. Comment on the task: what is done, what is left, the question with its options and what each would change. Put the question label on the task (Question or Вопрос — whichever the tracker already has).',
      '  4. As the last step, after the last commit, move the task to Backlog: a git hook moves the task forward after a commit. Check the status half a minute later and set Backlog again if the hook moved it.',
      '  5. End the turn with a short report. Even Keel takes the next task itself; in the morning the user answers in the task or in this session.',
    ].join('\n'),
    fixRules: (main) =>
      [
        '- There is no tracker task for this fix: do not create one or move statuses, and put no task id into commit messages.',
        fill`- Merge the fix into ${main} of the main checkout (git merge --no-edit in the main working copy). After that leave the worktree and the branch alone and do not push ${main} — Even Keel cleans up and checks the push.`,
      ].join('\n'),
    mainFixed: (red, fixed, main) =>
      fixed === null
        ? fill`Even Keel stopped you mid-turn: the check of ${main} failed on commit ${red}. The fix is not confirmed — ${main} may still be broken. Merge ${main} into your branch, resolve conflicts if there are any, and carry on with the task.`
        : fill`Even Keel stopped you mid-turn: the check of ${main} failed on commit ${red}. It is fixed, ${main} is now at commit ${fixed}. Merge ${main} into your branch, resolve conflicts if there are any, and carry on with the task.`,
  },
}
