import type { NoteRefusal, REVIEW_NOTICES } from '../../../src/notice/en-review.js'
import type { NoticeTexts } from '../../../src/notice/notice.js'

const NOTE_REFUSALS: Record<NoteRefusal, string> = {
  outside: 'файл находится вне папки задачи',
  secret: 'файлы .env (кроме .env.example) и .git нельзя публиковать',
  missing: 'файл или папка задачи отсутствует',
  notFile: 'путь не является обычным файлом',
  tooLarge: 'файл превышает предел размера описания',
  empty: 'описание пустое',
  unreadable: 'не удалось прочитать файл',
}

export const REVIEW_NOTICES_RU = {
  'review.denied': (p) => `${p.ci}: токен отклонён (HTTP ${p.status}) — ему нужна запись pull request репозитория`,
  'review.notOpened': (p) => `pull request задачи ${p.task} не открыт`,
  'review.notCompleted': (p) => `у задачи ${p.task} нечего открывать как pull request, но в трекере она не переведена в Done`,
  'review.notReady': (p) =>
    `PR-режиму ${p.project} негде открывать pull request, и цепочка не запускает задачи`,
  'review.cannotEnable': (p) => `PR-режим ${p.project} не включён`,
  'review.noRemote': (p) => `у ${p.project} нет remote на GitHub, GitLab или Forgejo, где открыть pull request`,
  'review.noToken': (p) => `ни у одного профиля нет токена для remote ${p.remote} (${p.web})`,
  'review.unsupportedHost': (p) => `remote ${p.remote} на ${p.host} не поддерживается для pull request: только GitHub, GitLab и Forgejo`,
  'review.noNote': (p) => p.reason === undefined
    ? `сессия не оставила описание pull request в ${p.path}`
    : `описание PR ${p.path} отклонено: ${NOTE_REFUSALS[p.reason]}${p.reason === 'tooLarge' ? ` (${p.limit} байт)` : ''}`,
  'review.noBranch': (p) => `${p.path} не на ветке`,
  'review.dirty': (p) => `в ${p.path} есть незакоммиченные изменения`,
  'review.nothingAhead': (p) => `у ${p.branch} нет коммитов сверх ${p.base}`,
  'review.pushFailed': (p) => `не удалось запушить ${p.branch} в ${p.remote}`,
  'review.pushBehind': (p) =>
    `в ${p.branch} на ${p.remote} есть коммиты, которых нет у сессии (например, конфликт разрешён на форже): сессия сливает их к себе и снова отмечает pull request`,
} satisfies { [K in keyof typeof REVIEW_NOTICES]: NoticeTexts[K] }
