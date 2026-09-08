#!/bin/zsh
set -e
cd "$(dirname "$0")"
clear
echo "=================================================="
echo " NEOVORA Audio Cloud v3.0 · Cloudflare 部署"
echo "=================================================="
if ! command -v node >/dev/null 2>&1; then
  echo "请先运行 一键启动.command 安装 Node.js。"
  read -n 1
  exit 1
fi
[ -d node_modules ] || npm install
echo "\n[1/3] 构建生产版本…"
npm run build
echo "\n[2/3] 登录 Cloudflare（首次会打开浏览器授权）…"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
echo "\n[3/3] 发布到 Cloudflare Workers Static Assets…"
npx wrangler deploy
echo "\n部署完成。以后修改代码后再次双击此文件即可重新发布。"
read -n 1
