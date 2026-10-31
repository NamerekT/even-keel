import type { Language } from '../language.js'
import { SESSION_MARK } from '../review/model.js'
import { fill } from '../sessions/prompt.js'
import type { ReturnReason } from './model.js'

export type HandoffReason = 'limit' | 'restart' | 'checkpoint' | 'mainFixed' | 'review' | ReturnReason

/** What a session is told of its pull request's feedback (BTN-205). */
export interface ReviewTexts {
  head: (url: string) => string
  changes: (author: string) => string
  /** A review that only comments. */
  reviewed: (author: string) => string
  /** A comment in the pull request's conversation. */
  talk: (author: string) => string
  comment: (path: string, line: number | null) => string
  ci: (title: string, url: string) => string
  conflict: (main: string) => string
  after: string
  /** The mark came on a branch with no commits beyond main: nothing was pushed or opened (BTN-222). */
  nothingAhead: (main: string) => string
  /** The task's previous pull request was closed unmerged; its remarks follow (BTN-223). */
  closed: (url: string) => string
  /** How many earlier remarks of the closed pull request are left out. */
  earlier: (count: number) => string
  noRemarks: string
  closedAfter: (main: string) => string
}

/** A task with nothing to merge, marked `NO CHANGES:` by its session out of PR mode (EKR-10). */
export interface UnchangedTexts {
  /** The mark came on a branch with commits beyond main: the task is not closed. */
  ahead: (main: string) => string
  /** The mark came with work left out of a commit: the task is not closed. */
  dirty: (main: string) => string
  /** The tracker comment on the task closed by the mark; `reason` — what the session wrote, `''` — nothing. */
  comment: (reason: string) => string
}

/** `main` in the texts is the project's main branch, whatever it is called. */
export interface PromptTexts {
  resume: string
  /** Out of PR mode: the session merges its branch itself, or marks a task with nothing to merge. */
  cleanup: (main: string) => string
  unchanged: UnchangedTexts
  /** In PR mode, in place of `cleanup`: the session marks its turn's end, Even Keel pushes and opens the pull request. */
  pullRequest: (main: string) => string
  review: ReviewTexts
  worktree: (path: string) => string
  branch: (branch: string) => string
  brief: (title: string) => string
  tracker: (title: string, project: string) => string
  shared: (text: string) => string
  project: (text: string) => string
  why: Record<HandoffReason, string>
  blockersClosed: (blockers: string[]) => string
  workdir: (path: string) => string
  transcript: (path: string) => string
  /** A session started after the previous one that failed before its first answer (BTN-650). */
  failed: (error: string | null, transcript: string | null) => string
  note: (path: string) => string
  begin: (main: string) => string
  recentSteps: string
  lastMessage: string
  unattended: string
  /** The rules of a session that fixes a red main without a task. */
  fixRules: (main: string) => string
  /** What a session stopped for a red main is told when it goes on; `fixed` — main after the fix, `null` — the fix was skipped. */
  mainFixed: (red: string, fixed: string | null, main: string) => string
  /** What the session resolving a release project's carry (BTN-369) merges and what conflicted. */
  carryReport: (facts: CarryFacts) => string
  /** The rules of the session that resolves a carry. */
  carryRules: (main: string) => string
  /** What the chat's `/handoff` asks the session for (BTN-557); `extra` — the user's words after the command. */
  handoff: (extra: string | null) => string
}

/** A release project's carry git could not merge, as its session is told (BTN-369). */
export interface CarryFacts {
  /** The release project by `projectLabel`, its branch, and the project it merges into with that project's branch. */
  release: string
  branch: string
  into: string
  main: string
  /** The ref the carry fetched the release branch into, in the repository the session works in. */
  ref: string
  commit: string
  commits: number
  files: string[]
  /** What git said of the merge; empty when it said nothing. */
  output: string
}

const carryOutput = (output: string): string[] => (output.trim() === '' ? [] : ['```', output.trim(), '```'])

export const PROMPTS: Record<Language, PromptTexts> = {
  ru: {
    resume: 'Лимит сброшен — продолжай с того же места.',
    cleanup: (main) =>
      [
        fill`- Когда задача готова и проверки проходят, закоммить работу и сам влей ветку в ${main} основного чекаута (git merge --no-edit в основной рабочей копии): слияние закрывает задачу. Worktree и ветку после этого не трогай и ${main} не пушь — уборку сделает Even Keel.`,
        fill`- Если задача не требует правок в репозитории (уже сделана в ${main}, исследование, ответ на вопрос) — вливать нечего: убери свои изменения, чтобы git status был пуст, а в ветке не было коммитов сверх ${main}, и закончи ход последней строкой \`NO CHANGES: <одна строка — почему>\`. Even Keel закроет задачу и запишет причину комментарием к ней.`,
      ].join('\n'),
    unchanged: {
      ahead: (main) =>
        fill`Задача не закрыта: в ветке есть коммиты сверх ${main}. Если они нужны — влей ветку в ${main} основного чекаута, как обычно. Если нет — сбрось ветку на ${main}, чтобы коммитов сверх него не осталось, и снова закончи ход строкой \`NO CHANGES: <почему>\`.`,
      dirty: (main) =>
        fill`Задача не закрыта: в worktree есть незакоммиченные изменения. Если они нужны — закоммить их и влей ветку в ${main} основного чекаута, как обычно. Если нет — убери их, чтобы git status был пуст, и снова закончи ход строкой \`NO CHANGES: <почему>\`.`,
      comment: (reason) => (reason === '' ? 'Задача закрыта без изменений в репозитории.' : fill`Задача закрыта без изменений в репозитории: ${reason}`),
    },
    pullRequest: (main) =>
      [
        fill`- Режим PR: ветку в ${main} не сливай — её сольёт человек через pull request. Это правило важнее шага слияния в навыке трекера, проверка перед слиянием тоже не нужна: проверяет CI на pull request.`,
        '- Когда работа готова (и одобрена, если в проекте есть ревьюер): закоммить всю работу (git status пуст), опиши pull request в .temp/pull-request.md (первая строка — заголовок, дальше тело) и закончи ход последней строкой `PULL REQUEST: .temp/pull-request.md`. Файл описания не коммить: Even Keel читает его из worktree, а `.temp/` git игнорирует. Ветку пушит и pull request открывает Even Keel; статус задачи не трогай.',
        fill`- Если задача не требует правок в репозитории (исследование, работа уже в ${main}) — всё равно закончи ход строкой \`PULL REQUEST: .temp/pull-request.md\`, файл описания тогда не нужен: Even Keel закроет задачу без pull request.`,
        fill`- Если пишешь комментарий в своём pull request (merge request) — добавь в его текст строку ${SESSION_MARK}: без неё Even Keel примет комментарий за замечание ревьюера и вернёт его тебе.`,
      ].join('\n'),
    review: {
      head: (url) => fill`На pull request ${url} пришли замечания:`,
      changes: (author) => fill`- Ревью ${author} просит правок:`,
      reviewed: (author) => fill`- Ревью ${author} с комментариями:`,
      talk: (author) => fill`- Комментарий ${author}:`,
      comment: (path, line) => (line === null ? fill`  - ${path}:` : fill`  - ${path}:${String(line)}:`),
      ci: (title, url) => fill`- Упал CI: ${title} — ${url}`,
      conflict: (main) => fill`- Pull request конфликтует с ${main}: слей свежий ${main} в свою ветку и разреши конфликты.`,
      after: 'Исправь, закоммить и снова закончи ход строкой `PULL REQUEST: .temp/pull-request.md` (описание обнови, если нужно, но не коммить): Even Keel запушит ветку в тот же pull request.',
      nothingAhead: (main) =>
        fill`Pull request не открыт: в ветке нет коммитов сверх ${main}, а в worktree есть незакоммиченные изменения. Закоммить работу и снова закончи ход строкой \`PULL REQUEST: .temp/pull-request.md\`. Если эти изменения не нужны — убери их, и по той же строке Even Keel закроет задачу без pull request.`,
      closed: (url) => fill`Прошлый pull request этой задачи, ${url}, закрыт без слияния. Замечания на нём:`,
      earlier: (count) => fill`- (более ранних замечаний не показано: ${String(count)} — они в самом pull request)`,
      noRemarks: '- (замечаний нет)',
      closedAfter: (main) =>
        fill`Его ветка удалена: задачу делаешь заново, на свежей ветке от ${main}. Учти замечания — в них может быть, почему pull request закрыли и что сделать иначе.`,
    },
    worktree: (path) => fill`- Worktree готов: ${path} — работай в нём, новый worktree не создавай.`,
    branch: (branch) => fill`- Ветка: ${branch} — не меняй её.`,
    brief: (title) => fill`Задача из трекера: ${title}`,
    tracker: (title, project) => fill`Трекер: ${title}, проект ${project}.`,
    shared: (text) => fill`Указания для всех проектов:\n${text}`,
    project: (text) => fill`Указания для этого проекта:\n${text}`,
    why: {
      limit: 'Продолжение: прошлая сессия по этой задаче упёрлась в лимит и остановлена, задачу доводишь ты.',
      restart: 'Продолжение: прошлую сессию по этой задаче остановил пользователь — она задачу не довела, доводишь ты.',
      checkpoint:
        'Продолжение: прошлая сессия по этой задаче поставила контрольную точку, чтобы не тащить раздутый контекст дальше, и остановлена — задачу доводишь ты.',
      mainFixed: 'Продолжение: прошлую сессию по этой задаче остановил Even Keel, потому что упала проверка main, — задачу доводишь ты.',
      review: 'Продолжение: прошлая сессия по этой задаче открыла pull request, на него пришли замечания, а её кэш уже остыл — замечания отрабатываешь ты.',
      returned:
        'Продолжение: прошлая сессия по этой задаче закончила ход и увела задачу из цепочки — скорее всего, с вопросом пользователю. Пользователь вернул её в цепочку: ответ — в описании задачи или в комментариях к ней после вопроса. Прочитай эти комментарии в трекере, даже если навык трекера велит не читать ленту задачи. Прошлая сессия остановлена, задачу доводишь ты.',
      unblocked: 'Продолжение: прошлая сессия отложила задачу из-за блокера и закончила ход. Блокеры больше не держат задачу, цепочка вернулась к ней. Прошлая сессия остановлена; продолжи её работу с передачей.',
      unskipped: 'Продолжение: задачу отпустили через «Пропустить», теперь вернули в цепочку. Прошлая сессия закончила ход и остановлена; продолжи её работу с передачей.',
    },
    blockersClosed: (blockers) => fill`Закрытые блокеры: ${blockers.join(', ')}. Прочитай описание задачи и результаты этих блокеров перед продолжением.`,
    workdir: (path) => fill`- Рабочая папка: ${path} — работай в ней, новый worktree не создавай.`,
    transcript: (path) => fill`- Транскрипт прошлой сессии: ${path} — целиком не читай, ищи в нём grep, если чего-то не хватает.`,
    failed: (error, transcript) =>
      `- Затем новая сессия упала до первого ответа${error === null ? '' : fill` (${error})`}${transcript === null ? '' : fill`, её транскрипт: ${transcript}`}.`,
    note: (path) => fill`- Записка о передаче: ${path} — прочитай её первой: что сделано, что осталось, следующая команда.`,
    begin: (main) => fill`- Начни с git status, git log ${main}..HEAD и описания задачи.`,
    handoff: (extra) => {
      const ask =
        'Пользователь из чата Even Keel просит передать задачу новой сессии. Оставь рабочее дерево как есть (коммитить не нужно), запиши `.temp/handoff.md` в корне рабочего дерева — что сделано, что осталось, текущие гипотезы, что уже пробовали и отбросили, важные файлы и символы, точная следующая команда — и закончи ход последней строкой `CHECKPOINT: .temp/handoff.md`. Новая сессия продолжит работу по этой записке.'
      return extra === null ? ask : fill`${ask}\n\nК просьбе пользователь добавил — учти это в записке и в том, что делаешь до неё:\n${extra}`
    },
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
        '- Перед концом хода останови свои фоновые команды (циклы ожидания, наблюдение за логом CI): пока они работают, Even Keel считает тебя занятым.',
      ].join('\n'),
    mainFixed: (red, fixed, main) =>
      fixed === null
        ? fill`Even Keel остановил тебя посреди хода: проверка ${main} упала на коммите ${red}. Починка не подтверждена — ${main} может быть ещё сломан. Подтяни ${main} в свою ветку, разреши конфликты, если будут, и продолжай задачу.`
        : fill`Even Keel остановил тебя посреди хода: проверка ${main} упала на коммите ${red}. Она починена, ${main} теперь на коммите ${fixed}. Подтяни ${main} в свою ветку, разреши конфликты, если будут, и продолжай задачу.`,
    carryReport: ({ release, branch, into, main, ref, commit, commits, files, output }) =>
      [
        fill`Перенос релиза: ветка ${branch} проекта ${release} не слилась в ${main} проекта ${into} — у git конфликты. Разреши их и влей перенос.`,
        '',
        fill`- Что сливать: коммит ${commit} — ветка ${branch}, как её забрал Even Keel (ref ${ref} в этом репозитории). Коммитов релиза, которых нет в ${main}: ${String(commits)}.`,
        fill`- Влей его в свою ветку: \`git merge --no-edit -m "Merge branch '${branch}' of ${release} into ${main}" ${commit}\`.`,
        fill`- Файлы с конфликтом: ${files.join(', ')}.`,
        fill`- Правило разрешения: устройство и тексты ветки ${main} главнее — смысл фикса из релиза переносится поверх них, а не наоборот.`,
        ...(output.trim() === '' ? [] : ['- Вывод git:', ...carryOutput(output)]),
      ].join('\n'),
    carryRules: (main) =>
      [
        '- Задачи в трекере на этот перенос нет: не заводи её и статусы не трогай, в сообщениях своих коммитов ID задач не пиши.',
        '- Прогони проверки проекта (тесты, сборку), как перед слиянием задачи.',
        fill`- Влей ветку в ${main} основного чекаута (git merge --no-edit в основной рабочей копии): перенос сделан, когда в ${main} есть коммит релиза. Worktree и ветку после этого не трогай и ${main} не пушь — уборку и пуш сделает Even Keel.`,
        '- Перед концом хода останови свои фоновые команды: пока они работают, Even Keel считает тебя занятым.',
      ].join('\n'),
  },
  en: {
    resume: 'The usage limit has reset — carry on from where you stopped.',
    cleanup: (main) =>
      [
        fill`- When the task is done and the checks pass, commit it and merge the branch into ${main} of the main checkout yourself (git merge --no-edit in the main working copy): the merge closes the task. After that leave the worktree and the branch alone and do not push ${main} — Even Keel cleans up.`,
        fill`- If the task needs no change in the repository (already done in ${main}, research, an answer to a question), there is nothing to merge: remove your changes so that git status is clean and the branch has no commits beyond ${main}, and end the turn with the last line \`NO CHANGES: <one line — why>\`. Even Keel closes the task and puts the reason in a comment on it.`,
      ].join('\n'),
    unchanged: {
      ahead: (main) =>
        fill`The task is not closed: the branch has commits beyond ${main}. If they are needed, merge the branch into ${main} of the main checkout as usual. If not, reset the branch to ${main} so that no commits beyond it are left, and end the turn with the line \`NO CHANGES: <why>\` again.`,
      dirty: (main) =>
        fill`The task is not closed: the worktree has uncommitted changes. If they are needed, commit them and merge the branch into ${main} of the main checkout as usual. If not, remove them so that git status is clean, and end the turn with the line \`NO CHANGES: <why>\` again.`,
      comment: (reason) => (reason === '' ? 'The task is closed with no change in the repository.' : fill`The task is closed with no change in the repository: ${reason}`),
    },
    pullRequest: (main) =>
      [
        fill`- PR mode: do not merge the branch into ${main} — a human merges it through a pull request. This rule outranks the merge step of the tracker's skill, and the check before a merge is not needed either: the CI checks the pull request.`,
        '- Once the work is done (and approved, where your project has a reviewer): commit all the work (git status is clean), describe the pull request in .temp/pull-request.md (the first line is the title, the body follows) and end the turn with the last line `PULL REQUEST: .temp/pull-request.md`. Do not commit the description file: Even Keel reads it from the worktree, and git ignores `.temp/`. Even Keel pushes the branch and opens the pull request; leave the task status alone.',
        fill`- If the task needs no change in the repository (research, work already in ${main}), still end the turn with the line \`PULL REQUEST: .temp/pull-request.md\`; the description file is not needed then: Even Keel closes the task without a pull request.`,
        fill`- If you write a comment on your own pull request (merge request), put the line ${SESSION_MARK} into its text: without it Even Keel takes the comment for a reviewer's remark and gives it back to you.`,
      ].join('\n'),
    review: {
      head: (url) => fill`The pull request ${url} got feedback:`,
      changes: (author) => fill`- A review by ${author} asks for changes:`,
      reviewed: (author) => fill`- A review by ${author} comments:`,
      talk: (author) => fill`- A comment by ${author}:`,
      comment: (path, line) => (line === null ? fill`  - ${path}:` : fill`  - ${path}:${String(line)}:`),
      ci: (title, url) => fill`- The CI failed: ${title} — ${url}`,
      conflict: (main) => fill`- The pull request conflicts with ${main}: merge the fresh ${main} into your branch and resolve the conflicts.`,
      after: 'Fix it, commit and end the turn with the line `PULL REQUEST: .temp/pull-request.md` again (update the description if needed, without committing it): Even Keel pushes the branch to the same pull request.',
      nothingAhead: (main) =>
        fill`The pull request was not opened: the branch has no commits beyond ${main}, and the worktree has uncommitted changes. Commit the work and end the turn with the line \`PULL REQUEST: .temp/pull-request.md\` again. If those changes are not needed, remove them, and on the same line Even Keel closes the task without a pull request.`,
      closed: (url) => fill`The previous pull request of this task, ${url}, was closed without a merge. The remarks on it:`,
      earlier: (count) => fill`- (earlier remarks not shown: ${String(count)} — they are in the pull request itself)`,
      noRemarks: '- (none)',
      closedAfter: (main) =>
        fill`Its branch is removed: you do the task over, on a fresh branch from ${main}. Take the remarks into account — they may say why the pull request was closed and what to do differently.`,
    },
    worktree: (path) => fill`- Worktree is ready: ${path} — work in it, do not create a new worktree.`,
    branch: (branch) => fill`- Branch: ${branch} — do not change it.`,
    brief: (title) => fill`Task from the tracker: ${title}`,
    tracker: (title, project) => fill`Tracker: ${title}, project ${project}.`,
    shared: (text) => fill`Instructions for every project:\n${text}`,
    project: (text) => fill`Instructions for this project:\n${text}`,
    why: {
      limit: 'Continuation: the previous session on this task hit the usage limit and was stopped; you finish the task.',
      restart: 'Continuation: the user stopped the previous session on this task before it finished the task; you finish it.',
      checkpoint:
        'Continuation: the previous session on this task set a checkpoint so as not to carry a bloated context further, and was stopped; you finish the task.',
      mainFixed: 'Continuation: Even Keel stopped the previous session on this task because the check of main failed; you finish the task.',
      review: 'Continuation: the previous session on this task opened a pull request, it got feedback, and that session\'s cache has gone cold; you work the feedback.',
      returned:
        'Continuation: the previous session on this task ended its turn and let the task leave the chain, most likely with a question to the user. The user brought the task back into the chain: the answer is in the task\'s description or in its comments after the question. Read those comments in the tracker, even where the tracker\'s skill says not to read the task\'s activity. The previous session is stopped; you finish the task.',
      unblocked: 'Continuation: the previous session postponed the task for a blocker and ended its turn. The blockers no longer hold the task and the chain returned to it. The previous session is stopped; continue its work from the handoff.',
      unskipped: 'Continuation: the task was released with Skip and has now been returned to the chain. The previous session ended its turn and is stopped; continue its work from the handoff.',
    },
    blockersClosed: (blockers) => fill`Closed blockers: ${blockers.join(', ')}. Read the task description and these blockers\' results before continuing.`,
    workdir: (path) => fill`- Working folder: ${path} — work in it, do not create a new worktree.`,
    transcript: (path) => fill`- Transcript of the previous session: ${path} — do not read it whole; grep it if something is missing.`,
    failed: (error, transcript) =>
      `- Then a new session failed before its first answer${error === null ? '' : fill` (${error})`}${transcript === null ? '' : fill`; its transcript: ${transcript}`}.`,
    note: (path) => fill`- Handoff note: ${path} — read it first: what is done, what is left, the next command.`,
    begin: (main) => fill`- Start with git status, git log ${main}..HEAD and the task description.`,
    handoff: (extra) => {
      const ask =
        "The user asks from Even Keel's chat to hand the task over to a fresh session. Leave the working tree as it is (no commit needed), write `.temp/handoff.md` at the root of the working tree — what is done, what is left, the current hypotheses, what was already tried and ruled out, the files and symbols that matter, the exact next command — and end your turn with a final line `CHECKPOINT: .temp/handoff.md`. A fresh session picks the work up from that note."
      return extra === null ? ask : fill`${ask}\n\nThe user adds to the request — take it into account in the note and in what you do before it:\n${extra}`
    },
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
        '- Before you end the turn, stop your background commands (wait loops, watching a CI log): while they run, Even Keel takes you for busy.',
      ].join('\n'),
    mainFixed: (red, fixed, main) =>
      fixed === null
        ? fill`Even Keel stopped you mid-turn: the check of ${main} failed on commit ${red}. The fix is not confirmed — ${main} may still be broken. Merge ${main} into your branch, resolve conflicts if there are any, and carry on with the task.`
        : fill`Even Keel stopped you mid-turn: the check of ${main} failed on commit ${red}. It is fixed, ${main} is now at commit ${fixed}. Merge ${main} into your branch, resolve conflicts if there are any, and carry on with the task.`,
    carryReport: ({ release, branch, into, main, ref, commit, commits, files, output }) =>
      [
        fill`Carrying a release: the branch ${branch} of ${release} did not merge into ${main} of ${into} — git found conflicts. Resolve them and merge the carry.`,
        '',
        fill`- What to merge: commit ${commit} — the branch ${branch} as Even Keel fetched it (the ref ${ref} in this repository). Release commits ${main} lacks: ${String(commits)}.`,
        fill`- Merge it into your branch: \`git merge --no-edit -m "Merge branch '${branch}' of ${release} into ${main}" ${commit}\`.`,
        fill`- Conflicted files: ${files.join(', ')}.`,
        fill`- How to resolve: the structure and the texts of ${main} win — the meaning of the release's fix goes on top of them, not the other way round.`,
        ...(output.trim() === '' ? [] : ["- What git said:", ...carryOutput(output)]),
      ].join('\n'),
    carryRules: (main) =>
      [
        '- There is no tracker task for this carry: do not create one or move statuses, and put no task id into your commit messages.',
        "- Run the project's checks (tests, build) as before merging a task.",
        fill`- Merge the branch into ${main} of the main checkout (git merge --no-edit in the main working copy): the carry is done once ${main} has the release commit. After that leave the worktree and the branch alone and do not push ${main} — Even Keel cleans up and pushes.`,
        '- Before you end the turn, stop your background commands: while they run, Even Keel takes you for busy.',
      ].join('\n'),
  },
}
