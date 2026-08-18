#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

app_root=${APP_ROOT:-/opt/exam-maker}
backup_dir=${BACKUP_DIR:-/var/backups/exam-maker}
retention_days=${RETENTION_DAYS:-14}
service_name=${SERVICE_NAME:-exam-maker.service}

if [[ ! $retention_days =~ ^[0-9]+$ ]] || (( retention_days < 1 || retention_days > 365 )); then
  echo "RETENTION_DAYS must be between 1 and 365." >&2
  exit 1
fi
if [[ $backup_dir == "/" || -z $backup_dir ]]; then
  echo "Unsafe backup directory." >&2
  exit 1
fi

install -d -m 0750 "$backup_dir"
was_active=false
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$service_name"; then
  was_active=true
fi
restart_service() {
  if [[ $was_active == true ]]; then
    systemctl start "$service_name"
  fi
}
trap restart_service EXIT

# Stopping sends SIGTERM, which makes sql.js flush its in-memory database before
# the archive is created. This avoids copying a partially written database.
if [[ $was_active == true ]]; then
  systemctl stop "$service_name"
fi

entries=()
[[ -d $app_root/server/data ]] && entries+=("server/data")
[[ -d $app_root/data ]] && entries+=("data")
if (( ${#entries[@]} == 0 )); then
  echo "No application data directory found under $app_root." >&2
  exit 1
fi

timestamp=$(date -u +'%Y%m%dT%H%M%SZ')
archive="$backup_dir/exam-maker-$timestamp.tar.gz"
temporary="$archive.tmp"
tar -C "$app_root" -czf "$temporary" "${entries[@]}"
mv "$temporary" "$archive"
sha256sum "$archive" > "$archive.sha256"

find "$backup_dir" -maxdepth 1 -type f -name 'exam-maker-*.tar.gz' -mtime "+$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'exam-maker-*.tar.gz.sha256' -mtime "+$retention_days" -delete

echo "Backup created: $archive"
