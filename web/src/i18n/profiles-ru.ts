import type { RightsUse } from './ru.js'

export const profilesRu = {
    title: 'Профили трекеров и CI',
    hint: 'Проект работает на профиле своего трекера. Профиль трекера по умолчанию идёт и сессиям, запущенным вручную (env ~/.claude/settings.json), и CI GitHub Actions проектов других трекеров. CI Forgejo берёт профиль Forgejo на хосте своего remote.',
    none: 'Профилей нет: без профиля цепочка не читает задачи трекера.',
    add: 'Добавить профиль',
    isDefault: 'по умолчанию',
    makeDefault: 'По умолчанию',
    edit: 'Изменить',
    rules: 'Правила',
    remove: 'Удалить',
    states: { unchecked: 'не проверен', checking: 'проверяется', ok: 'вход принят', refused: 'отказ', unreachable: 'не отвечает' },
    expires: (days: number) => (days <= 0 ? 'токен истёк' : `истекает через ${days} дн.`),
    login: (login: string) => `Вошли как ${login}`,
    projects: (keys: string) => `Проекты: ${keys}`,
    noProjects: 'Проектов на нём нет',
    ci: (remotes: string) => `CI: ${remotes}`,
    noCi: 'Ни один remote проектов не на его хосте',
    ciHidden: 'CI скрыт',
    hiddenCi: (remotes: string, kind: string) =>
      kind === 'forgejo'
        ? `CI Forgejo не показывается (${remotes}): токен не видит репозиторий или его Actions, нужно право read:repository`
        : `GitHub Actions не показываются (${remotes}): токен не достаёт до Actions репозитория, нужно право Actions: Read`,
    kindHint: {
      huly: 'Свой сервер или облако Huly',
      github: 'Issues и Actions на github.com',
      linear: 'Рабочее пространство Linear',
      forgejo: 'CI своего сервера Forgejo, не трекер',
    } as Record<string, string>,
    pullsRefused: 'PR отклонён',
    rulesOf: (name: string) => `Правила: ${name}`,
    rulesFor: (keys: string) => `Проекты на этом профиле: ${keys}.`,
    rulesNoProjects: 'Ни один проект пока не работает на этом профиле.',
    rulesHint:
      'Правила проектов на этом профиле: статусы и метки у каждого трекера свои. Список, который профиль не менял, остаётся общим; список, где профиль поменял хоть одну строку, — весь его, а свой список проекта сильнее. Майлстоуны проекта задаются на его вкладке трекера и в общих настройках.',
    deniedPulls: (remotes: string, kind: string) =>
      kind === 'forgejo'
        ? `Pull request не открылся (${remotes}): токену не хватило права write:repository`
        : `Pull request не открылся (${remotes}): токену не хватило права Pull requests: Read and write`,
    rightsIntro: {
      huly: 'Отдельная учётка с доступом к проектам: её почта и пароль или токен, если в настройках аккаунта вашего Huly есть страница API-токенов.',
      github: 'Fine-grained токен на владельца репозиториев.',
      linear: 'Личный ключ API.',
      forgejo: 'Адрес сервера и токен. CI и pull requests берут профиль, чей хост совпадает с хостом remote.',
    } as Record<string, string>,
    rightsUse: { tracker: 'Трекер', ci: 'CI', pullRequests: 'Pull requests' },
    rights: {
      huly: { tracker: 'чтение и запись задач проектов' },
      github: {
        tracker: 'Issues — Read and write',
        ci: 'Actions — Read',
        pullRequests: 'Pull requests — Read and write, Contents — Read, Actions — Read',
      },
      linear: { tracker: 'право записи' },
      forgejo: {
        ci: 'read:repository (репозитории и их Actions), read:user (проверка входа)',
        pullRequests: 'write:repository (открыть PR, читать его ревью), read:issue (комментарии в обсуждении PR), read:user',
      },
    } as Record<string, Partial<Record<RightsUse, string>>>,
    pushedByGit: 'Ветку PR-режим пушит git с учётными данными учётки, под которой работает служба, а не этим токеном.',
    howTo: 'Где получить',
    signIn: 'Вход',
    alternative: { HULY_TOKEN: 'Токен', HULY_EMAIL: 'Почта и пароль' } as Record<string, string>,
    name: 'Имя профиля',
    nameHint: 'Подставляется из ответа трекера, можно поменять.',
    kept: 'сохранён',
    hostLocked: 'Не меняется, пока профиль у проектов',
    fieldHints: {
      HULY_URL: 'Адрес сервера Huly, как он открывается в браузере.',
      HULY_WORKSPACE: 'Название рабочего пространства Huly, в котором проекты.',
      HULY_TOKEN: 'Токен учётки Huly из её настроек — вместо почты и пароля.',
      HULY_EMAIL: 'Почта отдельной учётки Huly, которая видит проекты.',
      HULY_PASSWORD: 'Пароль этой учётки Huly.',
      GITHUB_TOKEN: 'Fine-grained токен на репозитории владельца с правами по назначению — они выше.',
      LINEAR_TOKEN: 'Личный ключ API Linear с правом записи.',
      FORGEJO_URL: 'Адрес сервера Forgejo, как он открывается в браузере.',
      FORGEJO_TOKEN: 'Токен доступа с правами по назначению — они выше.',
    } as Record<string, string>,
    examples: {
      HULY_URL: 'https://huly.example.com',
      HULY_WORKSPACE: 'example-workspace',
      HULY_EMAIL: 'john.doe@example.com',
      FORGEJO_URL: 'https://forgejo.example.com',
    } as Record<string, string>,
    check: 'Проверить',
    checking: 'Проверяю…',
    duplicate: (name: string) => `Эта же учётка уже в профиле «${name}»`,
    save: 'Сохранить',
    editTitle: (name: string) => `Профиль ${name}`,
    field: 'Профиль',
    fieldHint: 'Учётка трекера, на которой идёт проект: его задачи, комментарии сессий и токен CI.',
    byDefault: (name: string) => `${name} (по умолчанию)`,
}
