# NEOVORA Audio V4.1.4 Free Google Hybrid

纯公网、一键部署版本。

## 翻译链路

1. Google Web Translate 非官方免费接口：优先路径。
2. Cloudflare Qwen3 30B-A3B FP8：Google 429、超时或接口异常时自动回退。
3. Cloudflare M2M100 1.2B：最后兜底。

## 转写

继续使用 Cloudflare Whisper large-v3-turbo，不改变已验证的 ASR 架构。

## 重要说明

Google Web 路径来自公开 GitHub 项目的逆向思路，不是 Google 官方 Translation API。它可能出现 429、接口变化或临时不可用，因此本版本不会把它作为唯一后端。所有异常都会自动切换到 Cloudflare 备用翻译，不要求用户重新操作。

## 部署

解压后双击 `一键部署.command`。
