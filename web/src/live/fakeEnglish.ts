/**
 * `?content=en` (BTN-1750): the default fake state with English task titles, milestones, labels and session lines, for the
 * guide's frames. Every string equal to a key below is replaced wherever it stands in the state and in a task card; the
 * rest stays. A new Russian string in the default state fails `fakeEnglish.test.ts` until it has its line here.
 */
const ENGLISH: Record<string, string> = {
  'Вопрос': 'Question',
  'v0.1 — каркас': 'v0.1 — skeleton',
  'v0.2 — удобство': 'v0.2 — comfort',
  'v0.3 — служба': 'v0.3 — service',
  'Переделка': 'Rework',
  'Каркас сервера': 'Server skeleton',
  'Чтение задач из трекера': 'Read tasks from the tracker',
  'Опрос трекера по расписанию': 'Poll the tracker on a schedule',
  'Запуск сессий в фоне': 'Start sessions in the background',
  'Цепочка задач по связям': 'Chain tasks by their links',
  'Страница проекта': 'Project page',
  'Разбор транскриптов сессий': 'Parse session transcripts',
  'Лимиты подписки в шапке': 'Subscription limits in the header',
  'Журнал запусков': 'Launch log',
  'Очередь цепочек': 'Chain queue',
  'Панель сессии': 'Session panel',
  'Вопрос: служба Windows или планировщик задач': 'Question: a Windows service or the Task Scheduler',
  'Уведомления на телефон': 'Phone notifications',
  'Установка службы одним скриптом': 'Install the service with one script',
  'Перезапуск службы после обновления': 'Restart the service after an update',
  'Тёмная тема для печати': 'Dark theme for printing',
  'Импорт задач из CSV': 'Import tasks from CSV',
  'Подсказки по горячим клавишам': 'Keyboard shortcut hints',
  'Старый формат отчёта': 'Old report format',
  'Вопрос: какие настройки переносить при импорте старого конфига, а какие спрашивать у пользователя заново':
    'Question: which settings to carry over when importing an old config, and which to ask the user again',
  'Экспорт отчёта в CSV': 'Export the report to CSV',
  'Фильтр отчёта по датам': 'Filter the report by dates',
  'Резервное копирование': 'Backups',
  'Ротация логов службы': 'Rotate the service logs',
  'Проверка свободного места на диске перед запуском': 'Check free disk space before a start',
  'Ядро цепочки': 'Chain core',
  'Удобство страницы': 'Page comfort',
  'Первый запуск': 'First run',
  'Читаю описание задачи и вложения.': 'Reading the task description and attachments.',
  'Порядок строится топологической сортировкой, цикл сейчас роняет сервер. Сначала тест на цикл.':
    'The order is a topological sort, and a cycle crashes the server now. A test for the cycle first.',
  'API Error: 529 overloaded, повтор через 4 с': 'API Error: 529 overloaded, retrying in 4 s',
  '[ABC-1] Стартовый экран': '[ABC-1] Start screen',
  '[ABC-2] Ошибки в логах': '[ABC-2] Errors in the logs',
  '[ABC-3] Новая схема конфигурации': '[ABC-3] New config schema',
  '[ABC-4] Ретраи загрузки': '[ABC-4] Download retries',
  '[ABC-5] Экспорт отчёта': '[ABC-5] Report export',
}

/** A copy of `value` with every string of the dictionary in English. */
export function withEnglishContent<T>(value: T): T {
  return english(value) as T
}

function english(value: unknown): unknown {
  if (typeof value === 'string') return ENGLISH[value] ?? value
  if (Array.isArray(value)) return value.map(english)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [ENGLISH[key] ?? key, english(each)]))
}
