# As a service

The service starts by itself and restarts Even Keel if it fails. Stopping the service does not kill running sessions: they belong to the CLI's daemon.

| | Runs as | Log |
| --- | --- | --- |
| Windows | a start at your sign-in, with a tray icon ([below](#windows-a-start-at-sign-in)) | `logs\even-keel.log` |
| Linux | a systemd user unit | `journalctl --user -u even-keel` |
| macOS | a launchd agent `local.even-keel` | `logs/even-keel.log` |

The log folder is the data folder's when installed with npm, the clone's own otherwise.

### Installed with npm

`npx even-keel` installs the package globally (`npm install --global even-keel`) and sets the service up: on Windows the start at sign-in below, elsewhere the package's own install script. Once installed, these set it up again and remove it:

```sh
even-keel install
even-keel uninstall
```

On Windows, `even-keel install --service` installs the Windows service `EvenKeel` instead of the start at sign-in ([Windows: without a sign-in](#windows-without-a-sign-in)).

`even-keel` with no command runs Even Keel in the terminal, on the same data folder.

Once the service is set up, `even-keel install` and `even-keel update` wait up to 30 seconds for the page and print `Open <address>`, the address built from `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT` (the environment, then `.env` of the data folder); a page that does not answer by then gets its address and the log's place. Only the first install from `npx` opens the address in your browser, and only when the page answered: never over SSH, and on Linux only with a display (`DISPLAY` or `WAYLAND_DISPLAY`) and `xdg-open`. On Linux without systemd there is no service, so it prints where the page will be once you run `even-keel`.

#### npm's global folder on macOS and Linux

Node from the nodejs.org installer puts npm's global folder under `/usr/local`, which belongs to root, so `npm install --global` fails with `EACCES`. `npx even-keel` checks the folder first and, when it cannot write there, installs nothing and prints these commands: they move the folder into your home (`~/.bashrc` instead of `~/.zshrc` in bash; with `SHELL` empty, as under `docker exec`, the shell of your account in `/etc/passwd`, and `~/.profile` when that is unknown too).

```sh
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npx even-keel
```

Do not use `sudo` instead: `sudo npx even-keel` would install the service for root, with root's data folder and accounts, and after a `sudo npm install --global` an update from the page fails the same way. `npx even-keel` refuses to run as root. Node from nvm or Homebrew leaves the folder writable by you and needs none of this.

The service runs from the global install, never from npx's cache, which npm may clear. The package keeps nothing of yours in its folder, since npm replaces the folder at every update: `.env`, `state/` and `logs/` are in the data folder.

| | Data folder |
| --- | --- |
| Windows | `%LOCALAPPDATA%\even-keel` |
| macOS | `~/Library/Application Support/even-keel` |
| Linux | `$XDG_DATA_HOME/even-keel` (`~/.local/share/even-keel`) |

`EVEN_KEEL_DATA` names another folder. The install script builds nothing; on Windows it puts the service host into the data folder too. The service must run as the user whose data folder it is; for another account, pass `-Data <folder>` to `install.ps1` (or set `EVEN_KEEL_DATA`).

### A clone as a service

After `npm run build`, as your own user. On Windows:

```sh
node dist/src/cli.js install
```

On Linux and macOS:

```sh
service/install.sh
```

From a clone the install also installs the dependencies and builds the page.

### Windows: a start at sign-in

`even-keel install` (a clone: `node dist/src/cli.js install`) runs as your own user, with no administrator and no PowerShell 7. It:

1. installs the dependencies and builds the page (a clone only);
2. compiles a small host `EvenKeel.exe` with the `csc.exe` that ships with Windows (.NET Framework 4), into the data folder's `service` (a clone: `service\bin`);
3. adds it to your sign-in start (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, the value `EvenKeel`), which shows in Settings → Apps → Startup and can be turned off there;
4. starts it.

The host keeps Even Keel running, restarts it if it fails and puts an icon in the tray:

- **Open the page**, or a double click on the icon;
- **Restart**, which also picks up programs installed since, git or an agent CLI: Even Keel starts with the system and user `PATH` read anew;
- **Quit**, until your next sign-in; `even-keel install` starts it again.

The dot on the icon and its tooltip say how it is:

| Dot | Means |
| --- | --- |
| green | it runs |
| amber | a chain is paused |
| blue | a session waits for your answer |
| grey | starting, or stopped for an update |
| red | it does not answer |

It runs only while you are signed in. After a Windows Update restart at night Even Keel waits for you to sign in, unless Windows signs you back in to finish the update: Settings → Accounts → Sign-in options → "Use my sign-in info to automatically finish setting up after an update" (an organization's policy may turn that off). Signing out stops it; running sessions go on as they would after any stop.

### Windows: PowerShell

Run the commands from cmd, or add `.cmd` to them in Windows PowerShell and PowerShell 7:

```powershell
npx.cmd even-keel
even-keel.cmd install
```

npm puts a `.ps1` wrapper next to each `.cmd` one, PowerShell picks the `.ps1`, and its default execution policy refuses to run it ("running scripts is disabled on this system"). Even Keel does not change the policy for you; if you want plain `npx` and `even-keel` there, this lifts the block:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

The commands Even Keel itself suggests are written for cmd.

### Windows: without a sign-in

For a machine where Even Keel must run with nobody signed in, Even Keel can be the Windows service `EvenKeel`. From PowerShell 7 as administrator, installed with npm:

```powershell
even-keel.cmd install --service
```

From a clone:

```powershell
service\install.ps1
```

From a clone it also installs the dependencies and builds the page; either way it compiles the service host the same way and registers the service under your account. The script never asks for your password: enter it in `services.msc` → EvenKeel → Properties → Log On, which also grants the "Log on as a service" right, then start the service.

One of the two per machine: they would take the same port, so `even-keel install` refuses while the service is installed, and `install.ps1` refuses while the start at sign-in is.

### Windows: long paths

Even Keel's own git calls handle paths past 260 characters already, and cleanup deletes a worktree folder git could not. For your own git and the sessions' git (deep `node_modules` in a worktree), turn long paths on once:

```sh
git config --global core.longpaths true
```

And the registry value `LongPathsEnabled`, from PowerShell as administrator:

```powershell
New-ItemProperty -Path HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
```

### Linux and macOS

`even-keel install` (a clone: `service/install.sh`), as your own user, not with `sudo`. The script takes `PATH` and `node` from your shell; if `node` changes (nvm and the like), run it again.

**Linux:** a systemd user unit; `systemctl --user status even-keel` shows it. A user unit stops when you log out; to keep it running:

```sh
loginctl enable-linger $USER
```

A Linux without systemd (WSL without `systemd=true`, OpenRC or runit) has no service to install: the script writes no unit, says so and exits with code 3; `npx even-keel` still leaves the package installed. Run `even-keel` (a clone: `npm start`) in a terminal or under your own process manager. On WSL, systemd is turned on by `[boot]` and `systemd=true` in `/etc/wsl.conf`, then `wsl --shutdown`. The same message comes when systemd runs but the shell has no user session of its own (after `su` or `sudo -u`): sign in as that user directly.

**macOS:** a launchd agent `local.even-keel`. It runs while you are signed in to the Mac's desktop, at the screen or through Screen Sharing; signing out stops it. An SSH login alone is not enough: the script then stops and asks you to sign in to the desktop first. A Mac without a screen keeps its desktop session through automatic login (System Settings → Users & Groups; needs FileVault off).

On both systems the installer waits up to 60 seconds for the service and its page to answer before reporting success.

It uses the address in your data folder's `.env`; `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT` set in the installer's shell take priority and are saved in the service definition.

A protected page can pass without entering its token.

On failure the installer exits with an error, shows the service state and recent log, and leaves the installation in place. Fix the reported problem and run the installer again.

On macOS also check **System Settings → General → Login Items → Allow in the Background**: the entry may be called `node`.

The service log records stop signals and fatal errors; it cannot record a forced kill or a machine failure.
