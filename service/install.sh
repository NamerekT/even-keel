#!/bin/sh
# Installs Even Keel as a per-user service: a systemd --user unit on Linux, a launchd agent on macOS.
# Run it as the user whose Claude accounts the sessions use, not through sudo. Run it again after
# updating the code: it rebuilds the page and restarts the service.
# PATH and the node binary are taken from this shell: sessions get the same PATH as your terminal.
# The npm package comes built and keeps its data and logs in EVEN_KEEL_DATA, otherwise the platform's data
# folder, since npm replaces the package's folder at every update; a checkout keeps them in itself.
set -eu

name=even-keel
label=local.even-keel
root=$(cd "$(dirname "$0")/.." && pwd)
node=$(command -v node) || {
  echo "install: node is not on PATH" >&2
  exit 1
}

cd "$root"
if [ -f "$root/src/main.ts" ]; then
  data=
  logs="$root/logs"
  npm install --no-audit --no-fund
  npm run build
else
  case "$(uname -s)" in
  Darwin) data="${EVEN_KEEL_DATA:-$HOME/Library/Application Support/even-keel}" ;;
  *) data="${EVEN_KEEL_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/even-keel}" ;;
  esac
  logs="$data/logs"
fi
mkdir -p "$logs"

# systemd expands % specifiers in unit files.
unit_value() { printf '%s' "$1" | sed 's/%/%%/g'; }
xml_value() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

if [ -z "$data" ]; then
  exec_args='--import tsx src/main.ts'
  unit_data=
  plist_args='    <string>--import</string>
    <string>tsx</string>
    <string>src/main.ts</string>'
  plist_data=
else
  exec_args=dist/src/main.js
  unit_data="Environment=\"EVEN_KEEL_DATA=$(unit_value "$data")\""
  plist_args='    <string>dist/src/main.js</string>'
  plist_data="    <key>EVEN_KEEL_DATA</key>
    <string>$(xml_value "$data")</string>"
fi

case "$(uname -s)" in
Linux)
  units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$units"
  # KillMode=process: stopping the service leaves the claude daemon and its background sessions running.
  cat >"$units/$name.service" <<EOF
[Unit]
Description=Even Keel
After=network-online.target

[Service]
WorkingDirectory=$(unit_value "$root")
ExecStart="$(unit_value "$node")" $exec_args
Environment="PATH=$(unit_value "$PATH")"
$unit_data
Restart=always
RestartSec=10
KillMode=process

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable "$name.service"
  systemctl --user restart "$name.service"
  echo "Service $name started. Log: journalctl --user -u $name -f"
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != yes ]; then
    echo "It stops when you log out. To keep it running: loginctl enable-linger $(id -un)"
  fi
  ;;
Darwin)
  agents="$HOME/Library/LaunchAgents"
  plist="$agents/$label.plist"
  log="$logs/even-keel.log"
  mkdir -p "$agents"
  # AbandonProcessGroup: stopping the agent leaves the claude daemon and its background sessions running.
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_value "$node")</string>
$plist_args
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_value "$root")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_value "$PATH")</string>
$plist_data
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_value "$log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_value "$log")</string>
</dict>
</plist>
EOF
  domain="gui/$(id -u)"
  launchctl bootout "$domain/$label" 2>/dev/null || true
  tries=0
  while launchctl print "$domain/$label" >/dev/null 2>&1 && [ "$tries" -lt 20 ]; do
    sleep 0.5
    tries=$((tries + 1))
  done
  launchctl bootstrap "$domain" "$plist"
  echo "Agent $label started. Log: $log"
  ;;
*)
  echo "install: $(uname -s) is not supported here; on Windows use service/install.ps1, elsewhere run npm start" >&2
  exit 1
  ;;
esac
