#!/bin/sh
set -eu
umask 077

source_dir=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)
libexec=$HOME/.local/libexec/macvendor
launch_agents=$HOME/Library/LaunchAgents
logs=$HOME/Library/Logs/macvendor
account=${USER:-macvendor}

mkdir -p "$libexec" "$launch_agents" "$logs" "$HOME/Documents/macvendor-backups"
chmod 700 "$libexec" "$logs" "$HOME/Documents/macvendor-backups"
install -m 0700 "$source_dir/macvendor-offhost-backup" "$libexec/macvendor-offhost-backup"
install -m 0700 "$source_dir/macvendor-ops-monitor" "$libexec/macvendor-ops-monitor"

if ! security find-generic-password -s macvendor-restic -a "$account" >/dev/null 2>&1; then
  password=$(openssl rand -base64 48)
  security add-generic-password -U -s macvendor-restic -a "$account" -w "$password" >/dev/null
  unset password
fi

for name in offhost-backup ops-monitor; do
  sed -e "s|__LIBEXEC__|$libexec|g" -e "s|__LOGS__|$logs|g" \
    "$source_dir/io.macvendor.$name.plist" > "$launch_agents/io.macvendor.$name.plist"
  plutil -lint "$launch_agents/io.macvendor.$name.plist" >/dev/null
  launchctl bootout "gui/$(id -u)/io.macvendor.$name" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$launch_agents/io.macvendor.$name.plist"
done

printf '%s\n' "Installed macvendor off-host backup and operations monitor launch agents."
