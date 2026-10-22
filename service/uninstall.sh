#!/bin/sh
# Removes the Even Keel service installed by install.sh.
# Background Claude sessions keep running: they belong to the claude daemon, not to Even Keel.
set -eu

name=even-keel
label=local.even-keel
root=$(cd "$(dirname "$0")/.." && pwd)

case "$(uname -s)" in
Linux)
  unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$name.service"
  if [ ! -f "$unit" ]; then
    echo "Service $name is not installed."
    exit 0
  fi
  systemctl --user disable --now "$name.service"
  rm -f "$unit"
  systemctl --user daemon-reload
  echo "Service $name removed."
  ;;
Darwin)
  plist="$HOME/Library/LaunchAgents/$label.plist"
  if [ ! -f "$plist" ]; then
    echo "Agent $label is not installed."
    exit 0
  fi
  log=$(sed -n 's:.*<string>\(.*even-keel\.log\)</string>.*:\1:p' "$plist" | head -n 1)
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$plist"
  echo "Agent $label removed. The log is kept: ${log:-$root/logs/even-keel.log}."
  ;;
*)
  echo "uninstall: $(uname -s) is not supported here; on Windows use service/uninstall.ps1" >&2
  exit 1
  ;;
esac
