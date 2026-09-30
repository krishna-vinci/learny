#!/usr/bin/env bash
# Install Studium as a systemd *user* service. Never runs sudo: a user unit keeps the
# app in the learner's own session, where the study tree and Pi config already live.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_source="$repo_root/deploy/studium.service"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

node_bin="$(dirname "$(command -v node)")"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not on PATH; install it (corepack enable) and rerun." >&2
  exit 1
fi

mkdir -p "$unit_dir"
# systemd user services don't inherit your shell PATH (nvm, corepack), so pin the node
# directory found now, and point WorkingDirectory/EnvironmentFile at this checkout.
sed -e "s|%h/learny|$repo_root|g" \
  -e "s|^ExecStart=.*|Environment=PATH=$node_bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin\nExecStart=$node_bin/pnpm --filter @studium/server start|" \
  "$unit_source" >"$unit_dir/studium.service"

systemctl --user daemon-reload
systemctl --user enable --now studium.service

echo "Studium is installed and running as a systemd user service."
echo
echo "To keep it running when you are logged out, enable lingering once:"
echo "    loginctl enable-linger $USER"
