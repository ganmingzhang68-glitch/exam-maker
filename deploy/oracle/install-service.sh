#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo DOMAIN=exam.example.com $0" >&2
  exit 1
fi

app_root=${APP_ROOT:-/opt/exam-maker}
app_user=${APP_USER:-exam-maker}
domain=${DOMAIN:-}
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

[[ $app_root == /* && $app_root != "/" ]] || { echo "APP_ROOT must be a safe absolute path." >&2; exit 1; }
id "$app_user" >/dev/null 2>&1 || { echo "User $app_user does not exist; run setup-host.sh first." >&2; exit 1; }
[[ -f $app_root/package.json && -d $app_root/.git ]] || { echo "Clone the repository into $app_root first." >&2; exit 1; }
[[ -f $app_root/.env ]] || { echo "Create $app_root/.env from env.production.example first." >&2; exit 1; }
[[ $domain =~ ^([A-Za-z0-9.-]+|_)$ ]] || { echo "Set DOMAIN to a hostname or public IP address." >&2; exit 1; }

chown "$app_user:$app_user" "$app_root/.env"
chmod 600 "$app_root/.env"
install -d -o "$app_user" -g "$app_user" -m 0750 "$app_root/server/data" "$app_root/server/data/exports"

sudo -u "$app_user" -H npm ci --prefix "$app_root"
sudo -u "$app_user" -H npm run build --prefix "$app_root"
APP_ROOT="$app_root" "$script_dir/preflight.sh"

escape_sed() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
root_escaped=$(escape_sed "$app_root")
user_escaped=$(escape_sed "$app_user")
domain_escaped=$(escape_sed "$domain")

sed -e "s|__APP_ROOT__|$root_escaped|g" -e "s|__APP_USER__|$user_escaped|g" \
  "$script_dir/exam-maker.service" > /etc/systemd/system/exam-maker.service
sed -e "s|__APP_ROOT__|$root_escaped|g" \
  "$script_dir/exam-maker-backup.service" > /etc/systemd/system/exam-maker-backup.service
install -m 0644 "$script_dir/exam-maker-backup.timer" /etc/systemd/system/exam-maker-backup.timer
sed -e "s|__APP_ROOT__|$root_escaped|g" -e "s|__DOMAIN__|$domain_escaped|g" \
  "$script_dir/nginx.conf" > /etc/nginx/sites-available/exam-maker
ln -sfn /etc/nginx/sites-available/exam-maker /etc/nginx/sites-enabled/exam-maker

systemctl daemon-reload
nginx -t
systemctl enable --now nginx
systemctl enable --now exam-maker.service
systemctl enable --now exam-maker-backup.timer

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null; then
    echo "Exam Maker is healthy."
    echo "Open http://$domain and configure HTTPS before public use."
    exit 0
  fi
  sleep 1
done

systemctl status exam-maker.service --no-pager || true
journalctl -u exam-maker.service -n 80 --no-pager || true
echo "Service did not become healthy." >&2
exit 1
