#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

app_root=${APP_ROOT:-/opt/exam-maker}
app_user=${APP_USER:-exam-maker}
branch=${DEPLOY_BRANCH:-main}
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
lock_file=/run/lock/exam-maker-deploy.lock

[[ $app_root == /* && $app_root != "/" ]] || { echo "Unsafe APP_ROOT." >&2; exit 1; }
[[ $branch =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Unsafe DEPLOY_BRANCH." >&2; exit 1; }
exec 9>"$lock_file"
flock -n 9 || { echo "Another deployment is already running." >&2; exit 1; }

tracked_changes=$(sudo -u "$app_user" -H git -C "$app_root" status --porcelain --untracked-files=no)
[[ -z $tracked_changes ]] || { echo "Tracked changes exist in $app_root; deployment stopped." >&2; exit 1; }

APP_ROOT="$app_root" "$script_dir/backup.sh"
sudo -u "$app_user" -H git -C "$app_root" fetch --prune origin
sudo -u "$app_user" -H git -C "$app_root" switch "$branch"
sudo -u "$app_user" -H git -C "$app_root" pull --ff-only origin "$branch"
sudo -u "$app_user" -H npm ci --prefix "$app_root"
sudo -u "$app_user" -H npm run build --prefix "$app_root"
APP_ROOT="$app_root" "$script_dir/preflight.sh"
nginx -t
systemctl restart exam-maker.service
systemctl reload nginx

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null; then
    echo "Deployment complete: $(sudo -u "$app_user" -H git -C "$app_root" rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

systemctl status exam-maker.service --no-pager || true
journalctl -u exam-maker.service -n 80 --no-pager || true
echo "Deployment finished building, but the health check failed." >&2
exit 1
