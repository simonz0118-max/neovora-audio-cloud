#!/bin/bash
set -Eeuo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$PWD"
REPO_NAME="neovora-audio-cloud"

trap 'echo; echo "部署中止。错误发生在第 $LINENO 行。请把终端最后 30 行截图发给我。"; read -r -p "按回车关闭窗口..." _' ERR

line(){ printf '\n============================================================\n%s\n============================================================\n' "$1"; }

line "1/5 检查一键部署环境"
if ! command -v brew >/dev/null 2>&1; then
  echo "首次运行：安装 Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
fi
if ! command -v node >/dev/null 2>&1; then brew install node; fi
if ! command -v gh >/dev/null 2>&1; then brew install gh; fi
if ! command -v git >/dev/null 2>&1; then brew install git; fi
node -v
npm -v

line "2/5 安装依赖并构建"
npm install
npm run build

echo "✓ 网站构建成功"

line "3/5 GitHub 自动备份"
if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "首次使用需要在浏览器授权 GitHub。"
  gh auth login -h github.com -p https -w
fi
GH_USER="$(gh api user --jq .login)"
FULL_REPO="$GH_USER/$REPO_NAME"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if gh repo view "$FULL_REPO" >/dev/null 2>&1; then
  gh repo clone "$FULL_REPO" "$TMP_DIR/repo" -- --quiet
else
  mkdir -p "$TMP_DIR/repo"
  git -C "$TMP_DIR/repo" init -q
  git -C "$TMP_DIR/repo" branch -M main
  gh repo create "$FULL_REPO" --public --description "NEOVORA Audio public cloud transcription and translation" --confirm >/dev/null
  git -C "$TMP_DIR/repo" remote add origin "https://github.com/$FULL_REPO.git"
fi

rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.wrangler/' \
  --exclude '.DS_Store' \
  "$PROJECT_DIR/" "$TMP_DIR/repo/"

git -C "$TMP_DIR/repo" add -A
if ! git -C "$TMP_DIR/repo" diff --cached --quiet; then
  git -C "$TMP_DIR/repo" -c user.name="NEOVORA Deploy" -c user.email="deploy@neovora.local" commit -m "Deploy NEOVORA Audio V4.1 Cloud" >/dev/null
  git -C "$TMP_DIR/repo" push -u origin main
  echo "✓ GitHub 备份完成"
else
  echo "✓ GitHub 无变化，无需重复提交"
fi

line "4/5 Cloudflare 登录与公网部署"
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "首次使用需要在浏览器授权 Cloudflare。"
  npx wrangler login
fi

DEPLOY_LOG="$(mktemp)"
npx wrangler deploy 2>&1 | tee "$DEPLOY_LOG"
SITE_URL="$(grep -Eo 'https://[^ ]+\.workers\.dev' "$DEPLOY_LOG" | tail -1 || true)"
rm -f "$DEPLOY_LOG"

echo "✓ Cloudflare Worker + Workers AI 已部署"

line "5/5 公网健康检查"
if [ -n "$SITE_URL" ]; then
  sleep 3
  HEALTH="$(curl -fsS "$SITE_URL/api/health" || true)"
  if echo "$HEALTH" | grep -q '"ok":true'; then
    echo "✓ 公网 AI 节点健康检查通过"
  else
    echo "⚠ Worker 已部署，但健康检查未确认成功。"
    echo "返回内容：$HEALTH"
  fi
else
  echo "⚠ Wrangler 已部署成功，但未能从终端输出自动解析 workers.dev 地址。"
fi

echo
echo "GitHub: https://github.com/$FULL_REPO"
if [ -n "$SITE_URL" ]; then echo "网站: $SITE_URL/app"; fi
echo
echo "V4.1 Cloud 不启动任何本地 AI 服务；关闭本终端和 Mac 都不影响已部署网站。"
if [ -n "$SITE_URL" ]; then open "$SITE_URL/app" >/dev/null 2>&1 || true; fi

read -r -p "部署完成。按回车关闭窗口..." _
