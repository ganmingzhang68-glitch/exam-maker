#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root: sudo $0 [size-in-GB]" >&2
  exit 1
fi

size_gb=${1:-4}
if [[ ! $size_gb =~ ^[0-9]+$ ]] || (( size_gb < 1 || size_gb > 32 )); then
  echo "Swap size must be an integer from 1 to 32 GB." >&2
  exit 1
fi

if swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
  echo "/swapfile is already active; no change made."
  exit 0
fi
if [[ -e /swapfile ]]; then
  echo "/swapfile exists but is not active. Inspect it before continuing." >&2
  exit 1
fi

fallocate -l "${size_gb}G" /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
if ! grep -qE '^/swapfile[[:space:]]' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "Created and enabled ${size_gb} GB swap at /swapfile."
