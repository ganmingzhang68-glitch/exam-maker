#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot detect the operating system." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ ${ID:-} != "ubuntu" ]]; then
  echo "This installer supports Ubuntu only; detected ${ID:-unknown}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git openssl nginx certbot python3-certbot-nginx \
  pandoc libreoffice-core libreoffice-writer \
  texlive-xetex texlive-latex-extra texlive-lang-chinese latexmk \
  fonts-noto-cjk fonts-wqy-microhei \
  python3 python3-numpy python3-sympy \
  rsync sqlite3 tar gzip

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
fi

if (( node_major < 22 )); then
  keyring=/usr/share/keyrings/nodesource.gpg
  keyfile=$(mktemp)
  trap 'rm -f "$keyfile"' EXIT
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$keyfile"
  gpg --dearmor --yes -o "$keyring" "$keyfile"
  echo "deb [signed-by=$keyring] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

if ! id exam-maker >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/exam-maker --shell /usr/sbin/nologin exam-maker
fi

install -d -o exam-maker -g exam-maker -m 0750 /opt/exam-maker
install -d -o root -g exam-maker -m 0750 /var/backups/exam-maker
fc-cache -f

memory_kb=$(awk '/MemTotal/ { print $2 }' /proc/meminfo)
if (( memory_kb < 7500000 )); then
  echo "WARNING: less than 8 GB RAM detected. Add swap with deploy/oracle/ensure-swap.sh."
fi

echo "Host dependencies installed."
echo "Node: $(node --version) ($(uname -m))"
echo "Next: clone the repository into /opt/exam-maker as the exam-maker user."
