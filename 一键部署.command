#!/bin/zsh
set -e
cd "$(dirname "$0")"
PROJECT_DIR="$PWD"
REPO_NAME="neovora-audio-cloud"
clear

echo "============================================================"
echo " NEOVORA Audio Cloud v3.0.2 · 一键完整部署"
echo " GitHub + Cloudflare Workers"
echo "============================================================"

pause_on_error() {
  echo "\n部署失败。请把上面的终端内容截图发给我。"
  read -n 1
}
trap pause_on_error ERR

# 1. 基础依赖
if ! command -v brew >/dev/null 2>&1; then
  echo "[1/7] 安装 Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
else
  echo "[1/7] Homebrew 已就绪"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[2/7] 安装 Node.js…"
  brew install node
else
  echo "[2/7] Node.js 已就绪: $(node -v)"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "[3/7] 安装 GitHub CLI…"
  brew install gh
else
  echo "[3/7] GitHub CLI 已就绪"
fi

# 2. GitHub 登录
echo "[4/7] 检查 GitHub 登录…"
if ! gh auth status >/dev/null 2>&1; then
  echo "首次使用需要在浏览器完成一次 GitHub 授权。"
  gh auth login -h github.com -p https -w
fi
GH_USER="$(gh api user --jq .login)"
FULL_REPO="$GH_USER/$REPO_NAME"

# 3. 安装依赖并构建
cd "$PROJECT_DIR"
echo "[5/7] 安装依赖并构建网站…"
npm install
npm run build

# 4. GitHub 同步。已有仓库时先 clone，再覆盖源码，避免 unrelated-history / push 冲突。
echo "[6/7] 同步 GitHub: $FULL_REPO"
TMP_ROOT="$(mktemp -d)"
SYNC_DIR="$TMP_ROOT/repo"

if gh repo view "$FULL_REPO" >/dev/null 2>&1; then
  gh repo clone "$FULL_REPO" "$SYNC_DIR" -- --quiet
else
  gh repo create "$FULL_REPO" --public --description "NEOVORA Audio transcription and translation web app"
  mkdir -p "$SYNC_DIR"
  git -C "$SYNC_DIR" init -q
  git -C "$SYNC_DIR" branch -M main
  git -C "$SYNC_DIR" remote add origin "https://github.com/$FULL_REPO.git"
fi

# 保留远端 .git，仅同步产品源码；不上传构建缓存和 node_modules。
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.wrangler' \
  "$PROJECT_DIR/" "$SYNC_DIR/"

cd "$SYNC_DIR"
git add -A
if ! git diff --cached --quiet; then
  git -c user.name="$GH_USER" -c user.email="$GH_USER@users.noreply.github.com" commit -m "NEOVORA Audio Cloud v3.0.2"
  git push -u origin main
else
  echo "GitHub 无代码变化，跳过 commit。"
fi
rm -rf "$TMP_ROOT"

# 5. Cloudflare 部署
cd "$PROJECT_DIR"
echo "[7/7] 部署 Cloudflare Workers…"
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "首次使用需要在浏览器完成一次 Cloudflare 授权。"
  npx wrangler login
fi

npm run build
DEPLOY_OUTPUT="$(npx wrangler deploy 2>&1 | tee /dev/tty)"

URL="$(printf '%s\n' "$DEPLOY_OUTPUT" | grep -Eo 'https://[^ ]+\.workers\.dev[^ ]*' | tail -1 || true)"

echo "\n============================================================"
echo " 部署完成"
echo "============================================================"
echo "GitHub: https://github.com/$FULL_REPO"
if [ -n "$URL" ]; then
  echo "网站: $URL"
  command -v open >/dev/null 2>&1 && open "$URL" || true
else
  echo "Cloudflare 已完成部署，请以上方 Wrangler 输出的网址为准。"
fi
echo "\n以后更新版本，只需要再次双击：一键部署.command"
read -n 1
