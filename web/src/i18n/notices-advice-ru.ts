import type { ADVICE } from '../../../src/notice/en-advice.js'
import { FORGES } from '../../../src/notice/en.js'
import type { NoticeAdvice } from '../../../src/notice/notice.js'

export const adviceRu = {
  'chain.unchangedNotChecked': () => 'ответьте сессии из чата или пропустите задачу',
  'chain.unchangedNotCompleted': () => 'переведите её сами и продолжите цепочку или пропустите задачу',
  'review.notOpened': () => 'исправьте доступ и нажмите «Снять с паузы», ответьте её сессии в чате или пропустите задачу',
  'review.notCompleted': () => 'переведите её сами и продолжите цепочку или пропустите задачу',
  'review.noNote': (p) => (p.reason === undefined ? undefined : 'запишите безопасную заметку в папке задачи, повторите метку и нажмите «Снять с паузы»'),
  'review.noBranch': () => 'переключите её на ветку задачи и нажмите «Снять с паузы» или пропустите задачу',
  'review.dirty': () => 'закоммитьте или уберите их и нажмите «Снять с паузы», ответьте её сессии в чате или пропустите задачу',
  'review.notReady': () => 'исправьте это, и цепочка пойдёт сама в течение минуты, или выключите PR-режим',
  'review.noToken': (p) => `добавьте профиль ${FORGES[p.kind]} его хоста`,
  'accept.notChecked': () => 'повторите через минуту',
  'accept.notCompleted': () => 'повторите или закройте её в трекере сами',
  'task.relabelFailed': () => 'проверьте права профиля трекера на изменение задач и меток и повторите попытку',
  'codex.hooksUntrusted': () => 'обновите Even Keel, а пока запустите задачу на другом провайдере',
  'copilot.binaryMissing': () => 'выберите «Проверенную» в «Версии CLI» Copilot (Настройки → Провайдеры и модели), затем возобновите цепочку',
  'chain.noTrackerMcp': () => 'включите пакет с ним или описание задачи — цепочка пойдёт сама',
  'changelog.unnoticed': () => 'если задача что-то меняет для пользователей, напишите это в её закрывающем комментарии и нажмите «Написать заново»',
  'storage.newer': () => 'верните его копию *.bak или обновите Even Keel',
  'storage.held': () => 'дождитесь его завершения или закройте другой экземпляр Even Keel',
  'storage.newerDatabase': () => 'обновите Even Keel',
  'packages.port': () => 'задайте другой EVEN_KEEL_MCP_PORT в .env Even Keel',
  'packages.marketplaceCliMissing': () => 'установите его и снова добавьте маркетплейс на странице «Аккаунты»',
} satisfies Required<Pick<NoticeAdvice, keyof typeof ADVICE>>
