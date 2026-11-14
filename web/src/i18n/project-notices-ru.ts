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
  openToAll: (place: string) =>
    `Репозиторий ${place} публичный: задачу в нём может открыть кто угодно. Задача человека не из репозитория ждёт в бэклоге, пока вы не нажмёте на ней «В цепочку»; ` +
    'задачи участников входят в цепочку сразу. Чтобы решать по каждой задаче самим, выберите в правилах этого источника «Только с обязательной меткой» и назовите метку.',
  openToAllRules: 'Правила',
  templateRequiredLabel: (label: string, templates: string[], place: string) =>
    `${templates.length === 1 ? 'Шаблон' : 'Шаблоны'} issue ${templates.join(', ')} в ${place} ${templates.length === 1 ? 'ставит' : 'ставят'} метку «${label}» любому автору, ` +
    `а без «${label}» задачи этого источника в цепочку не входят: issue кого угодно, ${templates.length === 1 ? 'открытая по нему' : 'открытая по ним'}, входит сразу. ` +
    'Уберите метку из шаблона или назовите другую в правилах этого источника.',
  templateIntakeLabel: (label: string, templates: string[]) =>
    `${templates.length === 1 ? 'Шаблон' : 'Шаблоны'} issue ${templates.join(', ')} ${templates.length === 1 ? 'ставит' : 'ставят'} метку «${label}» любому автору, ` +
    `а issue с «${label}» Even Keel берёт в трекер: issue кого угодно, ${templates.length === 1 ? 'открытая по нему' : 'открытая по ним'}, сразу становится задачей. ` +
    'Уберите метку из шаблона или выберите другую метку для приёма issue.',
  templateLabelSettings: 'Настройки',
}
