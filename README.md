# NEOVORA Audio V4.1 Cloud

公网测试版。无本地 AI Server、无 Cloudflare Tunnel、无 127.0.0.1 端口、无需保持 Mac 在线。

## 核心
- ASR: Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo`
- Translation: Cloudflare Workers AI `@cf/meta/m2m100-1.2b`
- Frontend/API: Cloudflare Workers + Static Assets
- VAD: 开启
- hallucination guard: Whisper 参数 + NEOVORA 重复片段保护
- VIP: 仅预留 provider/tier 架构，不收费

## 部署
只需双击：`一键部署.command`

首次运行可能弹出 GitHub 与 Cloudflare 浏览器授权。之后重复发布仍是同一个入口。

## 当前限制
V4.1 首版采用同步公网处理，单文件限制 20 MB。下一阶段加入 R2 + 长音频分块/队列；不要为了支持超大文件而重新引入本地服务器。

自动语言检测可用于转写；如果同时需要翻译，当前版本建议明确选择原语言，以确保 M2M100 翻译方向正确。
