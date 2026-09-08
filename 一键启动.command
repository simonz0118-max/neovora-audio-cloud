#!/bin/zsh
set -e
cd "$(dirname "$0")"
clear
echo "=================================================="
echo " NEOVORA Audio Cloud v3.0 · 本地开发启动"
echo "=================================================="
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "正在安装 Node.js…"
    brew install node
  else
    echo "未检测到 Node.js/Homebrew。请先安装 Node.js 20+。"
    read -n 1
    exit 1
  fi
fi
if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖…"
  npm install
fi
(open http://127.0.0.1:8788 >/dev/null 2>&1 &) || true
npm run dev
