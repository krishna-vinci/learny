#!/usr/bin/env bash
# Install Studium as a systemd *user* service. Never runs sudo: a user unit keeps the
# app in the learner's own session, where the study tree and Pi config already live.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_source="$repo_root/deploy/studium.service"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

mkdir -p "$unit_dir"
cp "$unit_source" "$unit_dir/studium.service"

systemctl --user daemon-reload
systemctl --user enable --now studium.service

echo "Studium is installed and running as a systemd user service."
echo
echo "To keep it running when you are logged out, enable lingering once:"
echo "    loginctl enable-linger $USER"
