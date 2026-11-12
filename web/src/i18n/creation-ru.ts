import { plural } from './plural.js'

const unit = (bytes: number, units: [string, string, string, string]) => {
  if (bytes < 1024) return `${bytes} ${units[0]}`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} ${units[1]}`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} ${units[2]}`
  return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} ${units[3]}`
}
const size = (bytes: number) => unit(bytes, ['Б', 'КБ', 'МБ', 'ГБ'])
const files = (count: number) => `${count} ${plural('ru', count, { one: 'файл', few: 'файла', many: 'файлов', other: 'файла' })}`

/** The wizard's "Repository" block and the window of a project being created (BTN-1048). */
export const creationRu = {
  source: 'Источник',
  sources: { clone: 'Клон', new: 'Новый репозиторий', existing: 'Существующий' },
  sourceHints: {
    clone: 'Even Keel клонирует репозиторий с remote в папку на этой машине.',
    new: 'Папка станет git-репозиторием, и всё, что в ней лежит, войдёт в первый коммит.',
    existing: 'Клон, который уже лежит на этой машине.',
  },
  remote: 'Адрес remote',
  remoteHint: 'Адрес, по которому git этой машины клонирует репозиторий: HTTPS или SSH. Закрытому репозиторию нужен вход git на этот сервер.',
  remotePlaceholder: 'https://github.com/owner/storefront.git',
  remoteRead: (branch: string | null): string => (branch === null ? 'Remote ответил: репозиторий пуст' : 'Remote ответил'),
  folder: 'Папка',
  folderHint: 'Имя папки в папке проектов Even Keel. Пусто — подставленное по адресу или по проекту.',
  folderOtherHint: 'Полный путь к папке. Клону нужна пустая папка или та, которой ещё нет.',
  folderOtherHintNew: 'Полный путь к папке. Её может не быть — Even Keel её создаст.',
  folderOtherHintPlain: 'Полный путь к папке. Её может не быть — Even Keel её создаст; в ней могут лежать файлы.',
  folderOtherPlaceholder: 'Полный путь',
  other: 'другая папка…',
  own: 'в папку проектов Even Keel',
  states: {
    free: 'свободна — Even Keel её создаст',
    empty: 'пустая',
    filled: 'в папке уже есть файлы — сессии будут работать с ними',
  },
  firstCommit: (count: number, bytes: number, capped: boolean) => `В папке ${capped ? 'больше ' : ''}${files(count)}, ${size(bytes)} — всё войдёт в первый коммит`,
  cloneThere: (path: string) => `В папке проектов уже есть клон этого remote на этой ветке: ${path}`,
  takeIt: 'Взять его',
  gitMissing: 'Git не запускается на машине Even Keel: проект в git-репозитории недоступен.',
  noIdentity: 'У git нет имени и почты для коммитов: клон и новый репозиторий недоступны.',
  gitSetup: 'Настроить git',
  window: {
    title: 'Создание проекта',
    steps: {
      folder: 'Папка',
      clone: 'Клонирование',
      lfs: 'Файлы LFS',
      init: 'Первый коммит',
      project: 'Запись проекта',
      trust: 'Доверие Claude Code',
      packages: 'Пакеты проекта',
    } as Record<string, string>,
    states: { waiting: 'ждёт', running: 'идёт', done: 'готово', failed: 'ошибка' },
    stages: {
      counting: 'подсчёт объектов',
      compressing: 'сжатие',
      receiving: 'загрузка',
      resolving: 'разбор изменений',
      files: 'файлы',
      lfs: 'файлы LFS',
    },
    received: (bytes: number, speed: number | undefined) => `${size(bytes)}${speed === undefined ? '' : ` · ${size(speed)}/с`}`,
    retry: 'Повторить',
    cancel: 'Отменить',
    close: 'Закрыть',
    open: 'Открыть проект',
    undoable: 'Отмена удалит то, что Even Keel успел сделать в папке.',
    kept: 'Проект уже записан и останется, даже если закрыть окно.',
  },
}
