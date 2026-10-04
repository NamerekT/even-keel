# Служба

Справка для сессий: установка и работа службы на разных системах. Без службы, на любой системе: `npm install`, `npm run build`, `npm start` в корне репозитория.

Сборщик статистики Tally работает внутри службы (раз в 5 минут, своим потоком), отдельной задачи планировщика или cron не нужно.

## Windows

- Хост службы — `service/EvenKeelService.cs`, собирается штатным `csc.exe` из .NET Framework при установке, сторонних обёрток нет. Держит `node --import tsx src/main.ts` в корне репозитория, перезапускает при падении, пишет вывод в `logs/even-keel.log`. Для отладки без службы: `EvenKeelService.exe <корень> <node.exe> --console`.
- `service/install.ps1` и `service/uninstall.ps1` — из PowerShell 7 от администратора. Пароль учётки скрипт не спрашивает: пользователь вводит его на вкладке «Вход в систему» в services.msc, она же выдаёт право «Вход в качестве службы».
- Служба читает `.env` и `even-keel.config.json` из корня репозитория; порт не должен быть занят ручным запуском.
- Служба отдаёт собранный `dist/web`: `install.ps1` запускает `npm run build`. После обновления кода — снова `install.ps1` (или `npm run build` и перезапуск службы), иначе страница старая или 503.
- Остановка службы фоновые сессии не убивает — они дети демона `claude daemon run`.

## Linux и macOS

- `service/install.sh` от своего пользователя (не через `sudo`): `npm install`, `npm run build`, затем на Linux — юнит `~/.config/systemd/user/even-keel.service` (`systemctl --user`, лог — `journalctl --user -u even-keel`), на macOS — агент `~/Library/LaunchAgents/local.even-keel.plist` (`launchctl`, лог — `logs/even-keel.log`, без ротации). Повторный запуск — пересборка и перезапуск. `service/uninstall.sh` убирает.
- `PATH` и путь к `node` берутся из оболочки установщика: сменился `node` (nvm и т. п.) — снова `install.sh`.
- Остановка службы фоновые сессии не убивает: `KillMode=process` у юнита, `AbandonProcessGroup` у агента. Юнит `--user` живёт, пока пользователь в системе; чтобы и без входа — `loginctl enable-linger <пользователь>` (установщик напомнит). Агент macOS работает только при входе в систему.
- Linux проверен вживую в WSL (Ubuntu 26.04, 2026-10-04): тесты и проверка типов, `install.sh` и `uninstall.sh`, вход в `claude` со страницы, лимиты `/usage`, запуск сессии в worktree задачи, после Done — остановка сессии, уборка worktree и ветки, своя синхронизация `main` с пушем в origin. Новый репозиторий CLI должен знать как доверенный: иначе запуск встаёт на паузу с просьбой один раз открыть `claude` в нём. macOS не проверялась.
