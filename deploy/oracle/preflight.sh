#!/usr/bin/env bash
set -Eeuo pipefail

app_root=${APP_ROOT:-/opt/exam-maker}
env_file="$app_root/.env"
failures=0

fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "PASS: $*"; }
warn() { echo "WARN: $*" >&2; }

read_env() {
  local name=$1
  local line
  local value
  line=$(grep -m1 -E "^${name}=" "$env_file" 2>/dev/null || true)
  value=${line#*=}
  value=${value%$'\r'}
  if (( ${#value} >= 2 )); then
    if [[ ${value:0:1} == '"' && ${value: -1} == '"' ]] ||
       [[ ${value:0:1} == "'" && ${value: -1} == "'" ]]; then
      value=${value:1:${#value}-2}
    fi
  fi
  printf '%s' "$value"
}

if [[ ! -f $env_file ]]; then
  fail "$env_file is missing"
else
  pass "production environment file exists"
  mode=$(stat -c '%a' "$env_file")
  if [[ $mode != "600" && $mode != "640" ]]; then
    warn "$env_file permissions are $mode; use 600 or 640"
  fi
  jwt_secret=$(read_env JWT_SECRET)
  ai_key=$(read_env AI_API_KEY)
  node_env=$(read_env NODE_ENV)
  [[ $node_env == "production" ]] || fail "NODE_ENV must be production"
  (( ${#jwt_secret} >= 32 )) || fail "JWT_SECRET must contain at least 32 characters"
  [[ $jwt_secret != "exam-maker-secret-dev" ]] || fail "development JWT_SECRET is forbidden"
  [[ $jwt_secret != replace-* ]] || fail "placeholder JWT_SECRET is forbidden"
  [[ -n $ai_key && $ai_key != replace-* ]] || fail "AI_API_KEY is not configured"
fi

for command_name in node npm nginx pandoc xelatex python3; do
  if command -v "$command_name" >/dev/null 2>&1; then
    pass "$command_name is available"
  else
    fail "$command_name is missing"
  fi
done
if command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; then
  pass "LibreOffice is available"
else
  fail "LibreOffice is missing"
fi

if command -v node >/dev/null 2>&1; then
  node_major=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
  (( node_major >= 22 )) || fail "Node.js 22 or newer is required"
  pass "Node architecture: $(node -p 'process.arch')"
fi
if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import numpy, sympy' >/dev/null 2>&1 || fail "Python numpy/sympy modules are missing"
fi

memory_kb=$(awk '/MemTotal/ { print $2 }' /proc/meminfo)
swap_kb=$(awk '/SwapTotal/ { print $2 }' /proc/meminfo)
if (( memory_kb < 3800000 )); then
  fail "less than 4 GB RAM detected"
elif (( memory_kb < 7500000 )); then
  warn "less than 8 GB RAM detected; keep generation concurrency at one"
else
  pass "memory is at least 8 GB"
fi
if (( memory_kb < 7500000 && swap_kb < 3800000 )); then
  warn "less than 4 GB swap detected on a memory-constrained host"
fi

[[ -f $app_root/server/dist/index.js ]] && pass "server build exists" || warn "server build is not present yet"
[[ -f $app_root/client/dist/index.html ]] && pass "client build exists" || warn "client build is not present yet"

if (( failures > 0 )); then
  echo "Preflight failed with $failures error(s)." >&2
  exit 1
fi
echo "Production preflight passed."
