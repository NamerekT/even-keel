import type { NoticeKind } from '../../../src/notice/kinds.js'
import { localized } from './index.js'

/** "Got it", "Don't show again" and the "Notices" section of the settings (BTN-759). */
export const noticeTexts = localized((language) => language === 'ru' ? {
  gotIt: 'Понятно',
  mute: 'Больше не показывать',
  title: 'Уведомления',
  hint: 'Предупреждения над цепочками и вверху страницы. Выключенный вид не показывается; ошибки, из-за которых цепочка стоит, показываются всегда, их можно только закрыть кнопкой «Понятно» до следующего изменения.',
  shared: 'Общие',
  projects: 'Предупреждения проектов',
  projectsHint: 'Значение для всех проектов; проект может задать своё в своих настройках → Уведомления.',
  projectHint: 'Предупреждения этого проекта. «Как в общих» следует настройкам → Уведомления.',
  asShared: (on: boolean) => `Как в общих: ${on ? 'показывать' : 'не показывать'}`,
  on: 'Показывать',
  off: 'Не показывать',
  kinds: {
    'protection.noRules': 'Агент без песочницы и без правил «Защиты»',
    'protection.remote': 'Защита ветки на сервере',
    'branch.drift': 'Основной чекаут не на основной ветке',
    'cli.versions': 'Версия CLI, на которой Even Keel не проверялся',
    'cli.check': 'Автоматическая проверка CLI',
    'usage.unread': 'Лимиты подписки не прочитаны',
    unattended: 'Включён режим без присмотра',
  } satisfies Record<NoticeKind, string>,
} : {
  gotIt: 'Got it',
  mute: "Don't show again",
  title: 'Notices',
  hint: 'Warnings above the chains and at the top of the page. A kind turned off is not shown; errors that hold a chain are always shown and only close with “Got it” until they change.',
  shared: 'Shared',
  projects: 'Project warnings',
  projectsHint: 'The value of every project; a project can set its own in its settings → Notices.',
  projectHint: 'This project’s warnings. “As shared” follows Settings → Notices.',
  asShared: (on: boolean) => `As shared: ${on ? 'show' : 'hide'}`,
  on: 'Show',
  off: 'Hide',
  kinds: {
    'protection.noRules': 'An agent without a sandbox and without Protection rules',
    'protection.remote': 'Branch protection on the server',
    'branch.drift': 'The main checkout is not on the main branch',
    'cli.versions': 'A CLI version Even Keel was not checked against',
    'cli.check': 'The automatic CLI check',
    'usage.unread': 'Subscription limits not read',
    unattended: 'Unattended mode is on',
  } satisfies Record<NoticeKind, string>,
})
