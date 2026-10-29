import { language } from '../i18n/index.js'

export const cliText = () => language === 'ru' ? {
  title: 'Проверенная копия CLI',
  missing: 'Копия ещё не скачана. Цепь будет ждать её готовности.',
  download: (mb: number) => `Скачать (≈${mb} МБ)`,
  system: 'Использовать установленную',
  checked: 'Переключиться на проверенную копию',
  again: 'Проверить снова',
  retry: 'Попробовать скачать снова',
  progress: 'Загрузка копии CLI',
  preparing: 'Подготовка загрузки…',
  installing: 'Проверка и распаковка…',
  size: (received: string, total: string) => `${received} из ${total} МБ`,
  about: (title: string, version: string, mb: number) => `Скачать ${title} ${version}, примерно ${mb} МБ? Even Keel сохранит свою копию для запуска сессий.`,
  installingCli: 'Установите CLI в терминале:',
} : {
  title: 'Checked CLI copy',
  missing: 'The copy has not been downloaded. The chain will wait until it is ready.',
  download: (mb: number) => `Download (≈${mb} MB)`,
  system: 'Use installed CLI',
  checked: 'Switch to the checked copy',
  again: 'Check again',
  retry: 'Try downloading again',
  progress: 'Downloading CLI copy',
  preparing: 'Preparing download…',
  installing: 'Verifying and unpacking…',
  size: (received: string, total: string) => `${received} of ${total} MB`,
  about: (title: string, version: string, mb: number) => `Download ${title} ${version}, about ${mb} MB? Even Keel will keep its own copy for sessions.`,
  installingCli: 'Install the CLI in a terminal:',
}

export const INSTALL: Record<string, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  opencode: 'npm install -g opencode-ai',
  copilot: 'npm install -g @github/copilot',
}
