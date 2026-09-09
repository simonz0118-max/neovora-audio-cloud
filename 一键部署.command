#!/bin/bash
set -Eeuo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$PWD"
REPO_NAME="neovora-audio-cloud"

cleanup(){
  [ -n "${TMP_DIR:-}" ] && rm -rf "$TMP_DIR" || true
}
trap cleanup EXIT
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
  --exclude '.runtime/' \
  --exclude '.DS_Store' \
  "$PROJECT_DIR/" "$TMP_DIR/repo/"

git -C "$TMP_DIR/repo" add -A
if ! git -C "$TMP_DIR/repo" diff --cached --quiet; then
  git -C "$TMP_DIR/repo" -c user.name="NEOVORA Deploy" -c user.email="deploy@neovora.local" commit -m "Deploy NEOVORA Audio V4.1.4 Free Google Hybrid" >/dev/null
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

line "5/5 公网 AI Gateway + 模型深度自检"
if [ -z "$SITE_URL" ]; then
  echo "✗ Wrangler 已部署，但无法解析 workers.dev 地址，不能完成 AI 自检。"
  exit 1
fi

sleep 4
HEALTH_URL="$SITE_URL/api/health?deep=1"
echo "正在验证 Whisper、Google 免费翻译优先链路、Qwen3 备用链路与 default AI Gateway..."
HEALTH_FILE="$(mktemp)"
HTTP_CODE="$(curl -sS -o "$HEALTH_FILE" -w '%{http_code}' "$HEALTH_URL" || true)"
HEALTH="$(cat "$HEALTH_FILE" 2>/dev/null || true)"
rm -f "$HEALTH_FILE"

if [ "$HTTP_CODE" = "200" ] && echo "$HEALTH" | grep -q '"ai_ready":true'; then
  echo "✓ AI 推理链路自检通过"
  echo "✓ default AI Gateway 已就绪"
  echo "✓ Whisper large-v3-turbo 可调用"
  echo "✓ Qwen3 30B 高质量备用翻译可调用"
  echo "✓ 自动语言识别不再依赖额外 AI 模型"
  echo "✓ Google Web 免费翻译为优先路径（失败自动回退）"
  echo "✓ M2M100 最后兜底翻译已保留"
else
  echo "✗ Worker 已部署，但 AI 推理链路没有通过。"
  echo "HTTP: $HTTP_CODE"
  echo "返回内容：$HEALTH"
  echo
  echo "V4.1.4 使用 Cloudflare 的 default AI Gateway；它应由首次经过认证的 Workers AI binding 请求自动创建。"
  echo "如果这里仍出现 2001，请把以上返回内容截图发给我，不要手工改其他配置。"
  exit 1
fi

echo
echo "GitHub: https://github.com/$FULL_REPO"
echo "网站: $SITE_URL/app"
echo
echo "V4.1.4 Free Google Hybrid 为纯公网架构，不启动任何本地 AI 服务；关闭本终端和 Mac 不影响网站。"
open "$SITE_URL/app" >/dev/null 2>&1 || true
read -r -p "部署完成。按回车关闭窗口..." _
