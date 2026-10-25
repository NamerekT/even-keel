import { plural } from './plural.js'

const counted = (one: string, few: string, many: string) => (count: number) => `${count} ${plural('ru', count, { one, few, many, other: few })}`

export const projectNoticesRu = {
  warnings: counted('предупреждение', 'предупреждения', 'предупреждений'),
  cleanupSummary: (tasks: string) => `Остатки уборки: ${tasks}`,
  dismissAll: 'Готово для всех',
  leftover: (task: string) => `${task} закрыта, но после неё не всё прошло гладко — проверьте руками.`,
  dismiss: 'Убрал',
  forwardWaits: (count: number, into: string) => `${counted('коммит', 'коммита', 'коммитов')(count)} этого проекта ждут переноса в ${into}.`,
  forwardPushFailed: (into: string) => `Релизная ветка влилась в ${into}, но не отправилась — отправит следующая синхронизация.`,
  forwardNow: 'Перенести сейчас',
  forwardConflict: (count: number, from: string, into: string, files: number) =>
    `${counted('коммит', 'коммита', 'коммитов')(count)} ${from} конфликту${count === 1 ? 'ет' : 'ют'} с ${into} в ${counted('файле', 'файлах', 'файлах')(files)}`,
  forwardResolve: 'Разрешить агентом',
  forwardMore: 'Подробнее',
  forwardAgent: (into: string) => `Агент разрешает конфликт в цепочке ${into}`,
  forwardAgentAsked: (into: string) => `Агент разрешит конфликт после текущей задачи ${into}`,
  forwardAgentOpen: 'Открыть',
}
