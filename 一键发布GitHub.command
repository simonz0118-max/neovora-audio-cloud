#!/bin/zsh
set -e
cd "$(dirname "$0")"
clear
echo "=================================================="
echo " NEOVORA Audio Cloud v3.0 · GitHub 发布"
echo "=================================================="
REPO_NAME="neovora-audio-cloud"
if ! command -v gh >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then brew install gh; else echo "缺少 GitHub CLI (gh)"; exit 1; fi
fi
if ! gh auth status >/dev/null 2>&1; then gh auth login; fi
if [ ! -d .git ]; then git init; git branch -M main; fi
git add .
git commit -m "NEOVORA Audio Cloud v3.0" || true
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
else
  git push -u origin main
fi
echo "\nGitHub 发布完成。"
read -n 1
