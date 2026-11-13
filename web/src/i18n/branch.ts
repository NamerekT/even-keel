import { localized } from './index.js'

/** The main branch field and the drift of the main checkout (BTN-754). */
export const branchTexts = localized((language) => language === 'ru' ? {
  current: 'сейчас в папке',
  remote: (remote: string) => `на ${remote}`,
  switch: (to: string, from: string | null) => (from === null ? `Чекаут перейдёт на ${to}` : `Чекаут перейдёт с ${from} на ${to}`),
  create: (to: string, from: string | null, head: string | null) =>
    `Ветки ${to} нет: она будет создана от ${from ?? 'текущего HEAD'}${head === null ? '' : ` (${head})`}, чекаут перейдёт на неё`,
  track: (to: string, remote: string) => `Ветка ${to} будет взята с ${remote}, чекаут перейдёт на неё`,
  drift: (current: string | null, branch: string) => `В папке сейчас ${current ?? 'отсоединённый HEAD'}, главная ветка проекта — ${branch}`,
  adopt: (current: string) => `Сделать ${current} главной`,
  restore: (branch: string) => `Вернуть папку на ${branch}`,
  byDefault: 'по умолчанию',
  cloned: (to: string) => `Склонируется ветка ${to}`,
  clonedNew: (to: string, head: string | null) =>
    head === null ? `Remote пуст: ветка ${to} будет создана в склонированном репозитории` : `Ветки ${to} на remote нет: склонируется ${head}, ветка ${to} будет создана от неё`,
  many: (total: number) => `Веток на remote: ${total} — подсказка показывает те, что подходят к введённому`,
} : {
  current: 'in the folder now',
  remote: (remote: string) => `on ${remote}`,
  switch: (to: string, from: string | null) => (from === null ? `The checkout will go to ${to}` : `The checkout will go from ${from} to ${to}`),
  create: (to: string, from: string | null, head: string | null) =>
    `There is no branch ${to}: it will be created from ${from ?? 'the current HEAD'}${head === null ? '' : ` (${head})`}, and the checkout will go to it`,
  track: (to: string, remote: string) => `The branch ${to} will be taken from ${remote}, and the checkout will go to it`,
  drift: (current: string | null, branch: string) => `The folder is on ${current ?? 'a detached HEAD'} now, the project's main branch is ${branch}`,
  adopt: (current: string) => `Make ${current} the main branch`,
  restore: (branch: string) => `Put the folder back on ${branch}`,
  byDefault: 'default',
  cloned: (to: string) => `The branch ${to} will be cloned`,
  clonedNew: (to: string, head: string | null) =>
    head === null ? `The remote is empty: the branch ${to} will be created in the clone` : `The remote has no branch ${to}: ${head} will be cloned, and ${to} created from it`,
  many: (total: number) => `The remote has ${total} branches: the list shows those that fit what is typed`,
})
