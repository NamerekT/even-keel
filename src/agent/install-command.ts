const NPM_INSTALL: Record<string, string> = {
  codex: 'npm install -g @openai/codex',
  opencode: 'npm install -g opencode-ai',
  copilot: 'npm install -g @github/copilot',
}

/**
 * The command that installs a provider's CLI on a machine of `platform` (`process.platform`), the one the page shows and
 * its "Install" button runs (BTN-1502); `''` — none known. Claude Code takes its native installer: it puts `claude` into
 * `~/.local/bin`, which Even Keel looks into first, and runs from a terminal too, while a newer npm skips the
 * postinstall that puts the binary in place of npm's placeholder (BTN-1196).
 */
export function installCommand(provider: string, platform: string): string {
  if (provider === 'claude') return platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'
  return NPM_INSTALL[provider] ?? ''
}
