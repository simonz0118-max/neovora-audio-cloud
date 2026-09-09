# NEOVORA Audio V4.1.2 Cloud

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
V4.1.2采用同步公网处理，单文件限制 20 MB。下一阶段加入 R2 + 长音频分块/队列；不要为了支持超大文件而重新引入本地服务器。

自动语言检测可用于转写；如果同时需要翻译，当前版本建议明确选择原语言，以确保 M2M100 翻译方向正确。


## V4.1.2 修复

- Workers AI 全部明确路由到 `default` AI Gateway。Cloudflare 会在首次经过认证的 Workers AI binding 请求时自动创建该 Gateway。
- 不再使用未预先创建的 `neovora-audio` 自定义 Gateway，修复错误 2001。
- 新增 `/api/health?deep=1`，实际调用翻译模型与 Whisper 模型验证公网 AI 链路。
- 一键部署只有在深度 AI 自检通过后才显示部署成功。


## V4.1.2 关键变化
- 自动检测原语言后直接把检测结果传给翻译，不再要求用户重新选择源语言。
- 翻译按 Cloudflare M2M100 官方 schema 使用 ISO 语言代码（例如 fr → zh）。
- 优先读取 Whisper 返回的语言元数据；若当前 Whisper 响应未包含语言字段，则调用 Cloudflare 托管的轻量语言识别模型作为公网 fallback。
- 增加时间轴质量统计与重复片段拦截计数。
- 前台移除 VIP/开发状态提示；VIP 仅保留代码扩展位。
