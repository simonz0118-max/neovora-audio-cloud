# NEOVORA Audio Cloud v3.0

商业化 Web 版本：浏览器端音频转写 + 浏览器端多语言翻译 + Cloudflare Workers Static Assets 部署。

## 架构
- 前端：React + Vite
- 转写：Transformers.js + Whisper ONNX
- 翻译：Transformers.js + M2M100 418M ONNX
- 音频兼容：Web Audio API；必要时 FFmpeg WASM 回退
- 部署：Cloudflare Workers Static Assets
- 模型缓存：浏览器 Cache Storage / Transformers.js cache

## 为什么不用 NLLB-200
NLLB-200 distilled 600M 的公开模型标注为 CC-BY-NC-4.0，不适合商业收费网站。V3 改用 Meta M2M100 418M，基础模型在 Hugging Face 标注 MIT license，可用于商业项目；Web 端采用其 Transformers.js ONNX 转换版本。

## 一键使用
- 双击 `一键启动.command`：本机启动开发版，地址 http://127.0.0.1:8788
- 双击 `一键发布GitHub.command`：首次创建并推送 `neovora-audio-cloud` GitHub 仓库；之后直接 push
- 双击 `一键部署Cloudflare.command`：首次授权 Cloudflare；之后一键重新部署

## 重要现实限制
1. 首次使用 Whisper / M2M100 会下载较大的模型文件。不同模型量化文件大小可能达到数百 MB 以上。
2. WebGPU 可明显提升性能；不支持 WebGPU 的浏览器会回退 WASM，速度较慢。
3. 浏览器原生对音频编解码器支持不一致。V3 会在原生解码失败时加载 FFmpeg WASM 作为回退。
4. 当前自动语言识别后的语言代码没有稳定从 Transformers.js Whisper 输出中暴露出来，所以“自动检测 + 翻译”可能需要用户手动确认源语言。生产版建议在转写结束后弹出一次语言确认。
5. 浏览器推理适合免费层和隐私优先产品，但老设备/手机上处理长音频可能较慢。商业 Pro 层后续应保留服务器 GPU 处理选项。

## 许可
- facebook/m2m100_418M: MIT（模型页）
- OpenAI Whisper: 请在正式上线前再次核对所选 ONNX 转换仓库及基础模型许可，并在网站法律页面保留第三方声明。
- FFmpeg: 商业部署前按最终构建的 FFmpeg 配置核查 LGPL/GPL 义务。
